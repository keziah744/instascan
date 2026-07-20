from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from instagrapi import Client
from instagrapi.exceptions import TwoFactorRequired
import networkx as nx
import threading
import os
import json
import time
import random

app = Flask(__name__)
socketio = SocketIO(app)
G = nx.DiGraph()

# Dictionnaire pour stocker les clients Instagram par utilisateur
instagram_clients = {}
session_directory = "instagram_sessions"

# Créer le dossier des sessions s'il n'existe pas
if not os.path.exists(session_directory):
    os.makedirs(session_directory)

# --- Gestion des codes de vérification (2FA / challenge Instagram) ---
# Quand Instagram demande un code (double authentification ou "challenge"
# email/SMS), le thread de scraping se met en pause et attend que le front
# renvoie le code via l'événement socket 'submit_2fa'.
verification_events = {}   # username -> threading.Event
verification_codes = {}    # username -> str (code saisi par l'utilisateur)


def request_verification_code(username, reason):
    """
    Demande un code de vérification au front-end et attend la réponse.
    Retourne le code saisi (str) ou None si l'utilisateur n'a pas répondu à temps.
    Bloque le thread appelant jusqu'à réception du code (max 5 minutes).
    """
    event = threading.Event()
    verification_events[username] = event
    verification_codes.pop(username, None)

    socketio.emit('need_2fa', {'username': username, 'reason': reason})

    got_code = event.wait(timeout=300)  # 5 minutes pour saisir le code
    verification_events.pop(username, None)

    if not got_code:
        return None
    return verification_codes.pop(username, None)


def login_with_verification(client, username, password):
    """
    Effectue le login instagrapi en gérant la double authentification (2FA).
    Les challenges email/SMS sont pris en charge via challenge_code_handler
    (défini sur le client avant l'appel).
    """
    try:
        client.login(username, password)
    except TwoFactorRequired:
        # Le compte a la double authentification activée : Instagram attend
        # un code (application d'authentification ou SMS).
        print(f"2FA requise pour {username}, demande du code au front...")
        code = request_verification_code(username, 'twofactor')
        if not code:
            raise Exception(
                "Code de double authentification non fourni (délai dépassé)."
            )
        client.login(username, password, verification_code=code)

def get_session_file(username):
    """Retourne le chemin du fichier de session pour un utilisateur"""
    return os.path.join(session_directory, f"{username}_session.json")

def wait_random(min_sec=3, max_sec=8):
    """Pause aléatoire pour éviter la détection"""
    delay = random.uniform(min_sec, max_sec)
    time.sleep(delay)

def get_or_create_instagram_client(username, password, sessionid=None):
    """
    Récupère ou crée un client Instagram avec gestion de session persistante.
    Si un sessionid est fourni, on se connecte directement avec (plus fiable :
    contourne le blocage anti-bot du login par mot de passe).
    """
    session_file = get_session_file(username)
    
    # Si le client existe déjà en mémoire, le retourner
    if username in instagram_clients:
        try:
            # Test rapide pour vérifier si la session est encore valide
            client = instagram_clients[username]
            client.account_info()  # Test de connectivité
            return client, True  # Session réutilisée
        except Exception as e:
            print(f"Session expirée pour {username}: {e}")
            # Supprimer le client défaillant
            del instagram_clients[username]
    
    # Créer un nouveau client
    client = Client()
    session_reused = False

    # Contexte de connexion cohérent (utilisateur français) + petites pauses :
    # réduit les rejets "login context suspect" qui provoquent un faux BadPassword.
    client.delay_range = [1, 3]
    try:
        client.set_locale('fr_FR')
        client.set_country('FR')
        client.set_country_code(33)
        client.set_timezone_offset(2 * 3600)  # Europe/Paris (UTC+2 en été)
    except Exception as e:
        print(f"Impossible de définir le contexte de connexion: {e}")

    # Gestion des "challenges" Instagram (vérification email/SMS) : instagrapi
    # appelle ce handler et attend le code, qu'on demande au front-end.
    def challenge_code_handler(challenge_username, choice):
        code = request_verification_code(challenge_username, f'challenge_{choice}')
        return code or False

    client.challenge_code_handler = challenge_code_handler

    # --- Connexion par sessionid (recommandé si le login par mot de passe est
    # bloqué par Instagram) : on réutilise la session déjà ouverte sur le web. ---
    if sessionid:
        try:
            print(f"Connexion par sessionid pour {username}")
            client.login_by_sessionid(sessionid.strip())
            client.dump_settings(session_file)
            print(f"Connexion par sessionid réussie pour {username}")
            instagram_clients[username] = client
            return client, False
        except Exception as e:
            print(f"Échec de la connexion par sessionid: {e}")
            raise e

    try:
        # Essayer de charger une session existante
        if os.path.exists(session_file):
            print(f"Chargement de la session existante pour {username}")
            client.load_settings(session_file)
            try:
                login_with_verification(client, username, password)
                session_reused = True
                print(f"Session rechargée avec succès pour {username}")
            except Exception as e:
                print(f"Échec du rechargement de session: {e}")
                # Supprimer le fichier de session corrompu
                os.remove(session_file)
                raise e

        # Si pas de session ou si le rechargement a échoué, créer une nouvelle session
        if not session_reused:
            print(f"Création d'une nouvelle session pour {username}")
            login_with_verification(client, username, password)
            client.dump_settings(session_file)
            print(f"Nouvelle session sauvegardée pour {username}")
            wait_random(5, 10)  # Attente plus longue après une nouvelle connexion
    
    except Exception as e:
        print(f"Erreur de connexion pour {username}: {e}")
        raise e
    
    # Stocker le client en mémoire
    instagram_clients[username] = client
    return client, session_reused

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('start_scraping')
def start_scraping(data):
    # Normalise le pseudo : enlève les espaces et un éventuel '@' collé au début
    # (Instagram attend le nom d'utilisateur seul, ce qui provoque sinon un BadPassword).
    username = (data['username'] or '').strip().lstrip('@')
    password = data.get('password') or ''
    sessionid = (data.get('sessionid') or '').strip()
    max_depth = int(data.get('max_depth', 2))

    thread = threading.Thread(
        target=explore_and_stream,
        args=(username, password, max_depth, sessionid)
    )
    thread.daemon = True
    thread.start()

def explore_and_stream(username, password, max_depth, sessionid=None):
    try:
        # Utiliser la fonction de gestion de session
        cl, session_reused = get_or_create_instagram_client(username, password, sessionid)
        
        # Informer le client si la session a été réutilisée
        socketio.emit('session_status', {
            'reused': session_reused,
            'message': 'Session réutilisée' if session_reused else 'Nouvelle connexion'
        })
        
        user_id = cl.user_id_from_username(username)
        visited = set()
        G.clear()
        
        def explore(current_username, user_id, depth):
            if depth > max_depth or current_username in visited:
                return
                
            visited.add(current_username)
            
            try:
                # Pause aléatoire pour éviter la détection
                wait_random(2, 5)
                
                followers = cl.user_followers(user_id)
                
                for i, f in enumerate(followers.values()):
                    G.add_edge(f.username, current_username)
                    
                    # Envoi en temps réel au front
                    socketio.emit('new_edge', {
                        'source': f.username, 
                        'target': current_username
                    })
                    
                    # Pause entre chaque follower
                    if i % 10 == 0 and i > 0:
                        wait_random(1, 3)
                    
                    # Exploration récursive
                    if depth < max_depth:
                        try:
                            explore(f.username, f.pk, depth + 1)
                        except Exception as e:
                            print(f"Erreur lors de l'exploration de {f.username}: {e}")
                            continue
                            
            except Exception as e:
                print(f"Erreur lors de l'exploration de {current_username}: {e}")
                socketio.emit('error', {
                    'message': f'Erreur lors de l\'exploration de {current_username}',
                    'error': str(e)
                })
        
        explore(username, user_id, 1)
        socketio.emit('done')
        
    except Exception as e:
        err_type = type(e).__name__
        err_text = str(e)
        print(f"Erreur générale: [{err_type}] {err_text}")

        # Message clair selon la cause réelle renvoyée par Instagram.
        low = err_text.lower()
        if err_type == 'BadPassword' or 'password' in low:
            message = "Mot de passe incorrect (utilise ton @ Instagram, pas ton e-mail)."
        elif 'few minutes' in low or '429' in low or 'wait' in low:
            message = ("Instagram bloque temporairement les tentatives de connexion "
                       "(trop d'essais). Attends 30 min à quelques heures avant de réessayer.")
        elif 'challenge' in low or err_type in ('ChallengeRequired', 'ChallengeError'):
            message = ("Instagram demande une vérification (« challenge ») qui n'a pas pu "
                       "être résolue automatiquement. Connecte-toi une fois dans l'app "
                       "Instagram officielle ou sur instagram.com, valide la vérification, "
                       "puis réessaie.")
        else:
            message = "Erreur de connexion Instagram"

        socketio.emit('error', {
            'message': message,
            'error': f'[{err_type}] {err_text}'
        })

@socketio.on('submit_2fa')
def submit_2fa(data):
    """Reçoit le code de vérification saisi par l'utilisateur et débloque le login."""
    username = data.get('username')
    code = (data.get('code') or '').strip()
    if username and username in verification_events:
        verification_codes[username] = code
        verification_events[username].set()

@socketio.on('clear_session')
def clear_session(data):
    """Permet de supprimer la session d'un utilisateur"""
    username = data.get('username')
    if username:
        session_file = get_session_file(username)
        
        # Supprimer de la mémoire
        if username in instagram_clients:
            del instagram_clients[username]
        
        # Supprimer le fichier
        if os.path.exists(session_file):
            os.remove(session_file)
            
        emit('session_cleared', {'username': username})

if __name__ == '__main__':
    socketio.run(app, debug=True)

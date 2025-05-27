from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ChallengeRequired, FeedbackRequired, PleaseWaitFewMinutes
import networkx as nx
import threading
import os
import json
import time
import random
import requests
from fake_useragent import UserAgent
import logging

app = Flask(__name__)
socketio = SocketIO(app)
G = nx.DiGraph()

# Configuration anti-détection améliorée
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
]

# Variables globales
instagram_clients = {}
session_directory = "instagram_sessions"
request_history = {}
failed_attempts = {}

# Créer le dossier des sessions
if not os.path.exists(session_directory):
    os.makedirs(session_directory)

# Réduire les logs verbeux
logging.getLogger("instagrapi").setLevel(logging.ERROR)

def get_session_file(username):
    return os.path.join(session_directory, f"{username}_session.json")

def enhanced_human_delay(min_sec=15, max_sec=45):
    """Délais plus longs pour éviter la détection CSRF"""
    current_hour = time.localtime().tm_hour
    
    # Facteur temps selon l'heure
    if 0 <= current_hour <= 6 or 22 <= current_hour <= 23:
        time_factor = 2.0  # Beaucoup plus lent la nuit
    elif 12 <= current_hour <= 14:
        time_factor = 1.5
    else:
        time_factor = 1.0
    
    # Délai avec distribution favorisant les longs délais
    base_delay = random.triangular(min_sec, max_sec, max_sec * 0.7)
    final_delay = base_delay * time_factor
    
    print(f"[PAUSE SÉCURISÉE] {final_delay:.1f}s")
    time.sleep(final_delay)

def setup_enhanced_client(client):
    """Configuration client renforcée contre CSRF"""
    # User agent moderne
    client.set_user_agent(random.choice(USER_AGENTS))
    
    # Configuration des settings pour éviter CSRF
    client.request_timeout = 30
    client.request_delay = (3, 8)  # Délai entre requêtes
    
    # Headers spéciaux anti-CSRF
    if hasattr(client, 'private') and hasattr(client.private, 'session'):
        session = client.private.session
        session.headers.update({
            'Accept': '*/*',
            'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'X-Requested-With': 'XMLHttpRequest',
            'X-IG-App-ID': '936619743392459',  # ID app officiel Instagram
            'X-Instagram-AJAX': '1',
            'X-CSRFToken': '',  # Sera rempli automatiquement
        })

def handle_login_challenge(client, username):
    """Gestion des challenges de connexion"""
    try:
        # Si un challenge est requis
        if hasattr(client, 'challenge_code_handler'):
            print(f"[CHALLENGE] Challenge détecté pour {username}")
            socketio.emit('challenge_required', {
                'username': username,
                'message': 'Instagram demande une vérification. Connectez-vous manuellement sur Instagram dans votre navigateur.'
            })
            return False
        return True
    except Exception as e:
        print(f"[CHALLENGE ERROR] {e}")
        return False

def safe_login_with_retry(client, username, password, max_retries=3):
    """Connexion sécurisée avec gestion d'erreurs et retry"""
    
    for attempt in range(max_retries):
        try:
            print(f"[LOGIN] Tentative {attempt + 1}/{max_retries} pour {username}")
            
            # Pause progressive entre les tentatives
            if attempt > 0:
                wait_time = (attempt ** 2) * 30  # 30s, 2min, 4.5min...
                print(f"[RETRY] Attente {wait_time}s avant nouvelle tentative")
                time.sleep(wait_time)
            
            # Configuration client
            setup_enhanced_client(client)
            
            # Tentative de connexion
            client.login(username, password)
            
            # Vérification post-connexion
            user_info = client.account_info()
            print(f"[LOGIN SUCCESS] Connecté: {user_info.username}")
            
            return True
            
        except ChallengeRequired as e:
            print(f"[CHALLENGE] Challenge requis: {e}")
            socketio.emit('challenge_required', {
                'username': username,
                'message': 'Vérification Instagram requise. Connectez-vous sur instagram.com dans votre navigateur.'
            })
            return False
            
        except FeedbackRequired as e:
            print(f"[FEEDBACK] Feedback requis: {e}")
            socketio.emit('feedback_required', {
                'username': username,
                'message': 'Action bloquée par Instagram. Attendez quelques heures.'
            })
            return False
            
        except PleaseWaitFewMinutes as e:
            print(f"[RATE_LIMIT] Rate limit: {e}")
            wait_time = 900  # 15 minutes
            print(f"[WAIT] Attente forcée de {wait_time/60} minutes")
            time.sleep(wait_time)
            continue
            
        except Exception as e:
            error_msg = str(e)
            print(f"[LOGIN ERROR] Tentative {attempt + 1}: {error_msg}")
            
            # Gestion spécifique de l'erreur CSRF
            if "CSRF token" in error_msg or "csrf" in error_msg.lower():
                print("[CSRF] Erreur CSRF détectée - Suppression de la session")
                session_file = get_session_file(username)
                if os.path.exists(session_file):
                    os.remove(session_file)
                
                # Pause longue avant retry
                time.sleep(60 * (attempt + 1))
                continue
            
            if attempt == max_retries - 1:
                raise e
    
    return False

def get_or_create_instagram_client(username, password):
    """Client Instagram avec gestion CSRF renforcée"""
    session_file = get_session_file(username)
    
    # Vérifier si trop d'échecs récents
    if username in failed_attempts:
        last_fail_time, fail_count = failed_attempts[username]
        if time.time() - last_fail_time < 3600 and fail_count >= 3:  # 3 échecs en 1h
            raise Exception(f"Trop d'échecs récents pour {username}. Attendez 1 heure.")
    
    # Client existant en mémoire
    if username in instagram_clients:
        try:
            client = instagram_clients[username]
            client.account_info()
            return client, True
        except Exception as e:
            print(f"[SESSION EXPIRED] {username}: {e}")
            del instagram_clients[username]
    
    # Nouveau client
    client = Client()
    session_reused = False
    
    try:
        # Essayer de charger une session existante
        if os.path.exists(session_file):
            print(f"[SESSION] Chargement session pour {username}")
            try:
                client.load_settings(session_file)
                setup_enhanced_client(client)
                
                # Test de la session
                client.get_timeline_feed()  # Test léger
                session_reused = True
                print(f"[SESSION] Session valide pour {username}")
                
            except Exception as e:
                print(f"[SESSION] Session corrompue: {e}")
                os.remove(session_file)
                session_reused = False
        
        # Nouvelle connexion si nécessaire
        if not session_reused:
            print(f"[NEW LOGIN] Nouvelle connexion pour {username}")
            
            # Pause avant connexion
            enhanced_human_delay(20, 40)
            
            # Tentative de connexion sécurisée
            if not safe_login_with_retry(client, username, password):
                raise Exception("Échec de connexion après plusieurs tentatives")
            
            # Sauvegarder la session
            client.dump_settings(session_file)
            print(f"[SESSION] Session sauvegardée pour {username}")
            
            # Pause post-connexion
            enhanced_human_delay(30, 60)
    
    except Exception as e:
        # Enregistrer l'échec
        failed_attempts[username] = (time.time(), failed_attempts.get(username, (0, 0))[1] + 1)
        print(f"[CONNECTION FAILED] {username}: {e}")
        raise e
    
    # Réinitialiser les échecs en cas de succès
    if username in failed_attempts:
        del failed_attempts[username]
    
    # Stocker le client
    instagram_clients[username] = client
    return client, session_reused

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('start_scraping')
def start_scraping(data):
    username = data['username']
    password = data['password']
    max_depth = int(data.get('max_depth', 2))
    
    thread = threading.Thread(
        target=explore_and_stream_secure, 
        args=(username, password, max_depth)
    )
    thread.daemon = True
    thread.start()

def explore_and_stream_secure(username, password, max_depth):
    """Version ultra-sécurisée contre CSRF"""
    try:
        # Vérification des horaires (optionnel)
        current_hour = time.localtime().tm_hour
        if not (8 <= current_hour <= 22):
            socketio.emit('warning', {
                'message': f'Scraping en dehors des heures recommandées ({current_hour}h). Risque plus élevé.'
            })
        
        # Connexion sécurisée
        cl, session_reused = get_or_create_instagram_client(username, password)
        
        socketio.emit('session_status', {
            'reused': session_reused,
            'message': 'Session réutilisée' if session_reused else 'Nouvelle connexion'
        })
        
        user_id = cl.user_id_from_username(username)
        visited = set()
        G.clear()
        
        def explore_ultra_safe(current_username, user_id, depth):
            if depth > max_depth or current_username in visited:
                return
                
            visited.add(current_username)
            
            try:
                # Pause obligatoire avant chaque action
                enhanced_human_delay(10, 25)
                
                # Vérifier les infos utilisateur
                user_info = cl.user_info(user_id)
                print(f"[EXPLORE] ({depth}/{max_depth}) {current_username}")
                
                if user_info.is_private and depth != 1:
                    print(f"[PRIVATE] {current_username} ignoré (privé)")
                    return
                
                # Récupérer les followers avec limite stricte
                followers = cl.user_followers(user_id)
                follower_list = list(followers.values())
                
                # Limitation drastique pour éviter CSRF
                max_followers = min(20, max(30 // depth, 5))
                if len(follower_list) > max_followers:
                    follower_list = random.sample(follower_list, max_followers)
                
                print(f"[FOLLOWERS] Traitement de {len(follower_list)} followers")
                
                for i, follower in enumerate(follower_list):
                    try:
                        G.add_edge(follower.username, current_username)
                        
                        socketio.emit('new_edge', {
                            'source': follower.username, 
                            'target': current_username
                        })
                        
                        # Pause entre chaque follower
                        if i % 3 == 0 and i > 0:
                            enhanced_human_delay(5, 12)
                        
                        # Exploration récursive très prudente
                        if depth < max_depth:
                            try:
                                enhanced_human_delay(8, 18)
                                explore_ultra_safe(follower.username, follower.pk, depth + 1)
                            except Exception as e:
                                print(f"[RECURSIVE ERROR] {follower.username}: {e}")
                                enhanced_human_delay(30, 60)
                                continue
                                
                    except Exception as e:
                        print(f"[FOLLOWER ERROR] {follower.username}: {e}")
                        continue
                        
            except Exception as e:
                print(f"[EXPLORE ERROR] {current_username}: {e}")
                socketio.emit('error', {
                    'message': f'Erreur lors de l\'exploration de {current_username}',
                    'error': str(e)
                })
                enhanced_human_delay(60, 120)  # Pause longue en cas d'erreur
        
        # Démarrer l'exploration
        explore_ultra_safe(username, user_id, 1)
        socketio.emit('done')
        
    except Exception as e:
        error_msg = str(e)
        print(f"[MAIN ERROR] {error_msg}")
        
        # Messages d'erreur spécifiques
        if "CSRF" in error_msg:
            socketio.emit('error', {
                'message': 'Erreur CSRF - Connectez-vous sur Instagram dans votre navigateur puis réessayez dans 30 minutes',
                'error': 'CSRF_ERROR'
            })
        elif "Challenge" in error_msg:
            socketio.emit('error', {
                'message': 'Vérification Instagram requise - Connectez-vous sur instagram.com',
                'error': 'CHALLENGE_ERROR'
            })
        else:
            socketio.emit('error', {
                'message': 'Erreur de connexion Instagram',
                'error': str(e)
            })

@socketio.on('clear_session')
def clear_session(data):
    username = data.get('username')
    if username:
        session_file = get_session_file(username)
        
        if username in instagram_clients:
            del instagram_clients[username]
        
        if username in request_history:
            del request_history[username]
            
        if username in failed_attempts:
            del failed_attempts[username]
        
        if os.path.exists(session_file):
            os.remove(session_file)
            
        emit('session_cleared', {'username': username})

if __name__ == '__main__':
    socketio.run(app, debug=False, host='127.0.0.1', port=5000)
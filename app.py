from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from instagrapi import Client
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

def get_session_file(username):
    """Retourne le chemin du fichier de session pour un utilisateur"""
    return os.path.join(session_directory, f"{username}_session.json")

def wait_random(min_sec=3, max_sec=8):
    """Pause aléatoire pour éviter la détection"""
    delay = random.uniform(min_sec, max_sec)
    time.sleep(delay)

def get_or_create_instagram_client(username, password):
    """
    Récupère ou crée un client Instagram avec gestion de session persistante
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
    
    try:
        # Essayer de charger une session existante
        if os.path.exists(session_file):
            print(f"Chargement de la session existante pour {username}")
            client.load_settings(session_file)
            try:
                client.login(username, password)
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
            client.login(username, password)
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
    username = data['username']
    password = data['password']
    max_depth = int(data.get('max_depth', 2))
    
    thread = threading.Thread(
        target=explore_and_stream, 
        args=(username, password, max_depth)
    )
    thread.daemon = True
    thread.start()

def explore_and_stream(username, password, max_depth):
    try:
        # Utiliser la fonction de gestion de session
        cl, session_reused = get_or_create_instagram_client(username, password)
        
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
        print(f"Erreur générale: {e}")
        socketio.emit('error', {
            'message': 'Erreur de connexion Instagram',
            'error': str(e)
        })

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

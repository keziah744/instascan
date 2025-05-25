from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from instagrapi import Client
import networkx as nx
import threading

app = Flask(__name__)
socketio = SocketIO(app)
G = nx.DiGraph()

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('start_scraping')
def start_scraping(data):
    username = data['username']
    password = data['password']
    max_depth = int(data.get('max_depth', 2))
    thread = threading.Thread(target=explore_and_stream, args=(username, password, max_depth))
    thread.daemon = True
    thread.start()

def explore_and_stream(username, password, max_depth):
    cl = Client()
    cl.login(username, password)
    user_id = cl.user_id_from_username(username)
    visited = set()
    G.clear()
    def explore(current_username, user_id, depth):
        if depth > max_depth or current_username in visited:
            return
        visited.add(current_username)
        followers = cl.user_followers(user_id)
        for f in followers.values():
            G.add_edge(f.username, current_username)
            # Envoi en temps réel au front
            socketio.emit('new_edge', {'source': f.username, 'target': current_username})
            if depth < max_depth:
                explore(f.username, f.pk, depth+1)
    explore(username, user_id, 1)
    socketio.emit('done')

if __name__ == '__main__':
    socketio.run(app, debug=True)
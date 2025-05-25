import time
import random
import os
from plyer import notification
import networkx as nx
import matplotlib.pyplot as plt
from instagrapi import Client

LOG_FILE = "instagrapi_network.log"

def log_and_print(message):
    """Affiche et journalise le message dans un fichier de log."""
    print(message)
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("=== Début du log Instagrapi Network ===\n")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(message + "\n")

def send_notification(title, message):
    """Envoie une notification système (Windows/Mac/Linux). Tronque le message si trop long pour Windows."""
    try:
        # Windows limite la longueur des messages de notification à 256 caractères.
        if len(message) > 250:
            message = message[:247] + "..."
        notification.notify(
            title=title,
            message=message,
            timeout=15
        )
    except Exception as e:
        log_and_print(f"[ERREUR NOTIF] : {e}")

def wait_random(min_sec=8, max_sec=20):
    """Pause aléatoire pour ressembler à un humain."""
    delay = random.uniform(min_sec, max_sec)
    log_and_print(f"[PAUSE] Attente {delay:.1f} secondes...")
    time.sleep(delay)

def handle_rate_limit(e, retry_count):
    """Gestion avancée du blocage serveur, avec backoff exponentiel."""
    base_wait = 1800  # 30 minutes
    max_wait = 8 * 3600  # 8 heures
    wait_time = min(base_wait * (2 ** retry_count), max_wait)
    log_and_print(f"[BLOCAGE SERVEUR] : {e}")
    log_and_print(f"[INFO] Blocage serveur détecté {retry_count+1} fois consécutives.")
    log_and_print(f"[INFO] Pause anti-blocage de {wait_time // 60} minutes (exponentiel)...")
    send_notification(
        "Blocage Instagram sévère",
        f"Serveur a bloqué le script {retry_count+1} fois. Pause de {wait_time // 60} minutes."
    )
    time.sleep(wait_time)

def explore_followers(cl, G, username, user_id, current_depth, max_depth, visited, retry_count):
    """
    Explore les followers récursivement jusqu'à la profondeur max_depth.
    - cl: client instagrapi
    - G: graphe networkx
    - username: utilisateur courant (point d'origine des liens)
    - user_id: identifiant Instagram du user
    - current_depth: profondeur actuelle
    - max_depth: profondeur maximale
    - visited: set des usernames déjà explorés (évite boucles)
    - retry_count: pour le backoff exponentiel en cas de blocage
    """
    if current_depth > max_depth:
        return
    if username in visited:
        return
    visited.add(username)
    try:
        user_info = cl.user_info(user_id)
        log_and_print(f"[INFO] ({current_depth}/{max_depth}) {username} ({user_info.follower_count} followers)")
        if user_info.is_private and current_depth != 1:
            log_and_print(f"[PRIVÉ] {username} est privé, ignoré à ce niveau.")
            return
        followers = cl.user_followers(user_id)
        for i, follower in enumerate(followers.values()):
            G.add_edge(follower.username, username)
            if i % 50 == 0 and i != 0:
                log_and_print(f"[INFO] Followers de {username} récupérés : {i}")
            wait_random()
            # Récursivité : descend dans la profondeur si autorisé
            if current_depth < max_depth:
                try:
                    explore_followers(
                        cl, G, follower.username, follower.pk,
                        current_depth + 1, max_depth, visited, retry_count
                    )
                except Exception as e:
                    log_and_print(f"[ERREUR] Impossible d’accéder à {follower.username} : {e}")
                    wait_random(30, 60)
                    continue
    except Exception as e:
        if "Please wait a few minutes" in str(e) or "429" in str(e):
            handle_rate_limit(e, retry_count)
            retry_count += 1
        else:
            log_and_print(f"[ERREUR GÉNÉRALE] : {e}")
            wait_random(30, 60)

def main():
    username = "test_etude_social"  # Remplace par ton @ Instagram (pas l'e-mail)
    password = "*fa76Ad:g3FkX/q"    # Remplace par ton mot de passe Instagram
    session_file = f"{username}_session.json"
    wait_on_error = 120  # secondes à attendre en cas d'erreur normale
    max_depth = 2        # <-- MODIFIE CETTE VALEUR : 1=juste tes followers, 2=+followers de tes followers, 3=etc.

    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("=== Début du log Instagrapi Network ===\n")

    retry_count = 0
    cl = Client()
    while True:
        try:
            # Chargement ou login avec sauvegarde de session
            if os.path.exists(session_file):
                cl.load_settings(session_file)
                try:
                    cl.login(username, password)
                    log_and_print(f"[OK] Session chargée et login pour {username}")
                except Exception as e:
                    log_and_print(f"[ERREUR LOGIN SESSION] : {e}")
                    os.remove(session_file)
                    log_and_print("Session supprimée, nouvelle tentative de login...")
                    continue
            else:
                try:
                    cl.login(username, password)
                    cl.dump_settings(session_file)
                    log_and_print("[OK] Session créée et sauvegardée.")
                except Exception as le:
                    log_and_print(f"[ERREUR LOGIN] : {le}")
                    send_notification("Checkpoint ou erreur login", "Connecte-toi sur Instagram dans le navigateur, valide le checkpoint si besoin, puis relance le script.")
                    break
                wait_random(10, 20)

            user_id = cl.user_id_from_username(username)
            G = nx.DiGraph()
            visited = set()
            log_and_print(f"[INFO] Exploration du réseau jusqu'à la profondeur {max_depth}...")
            explore_followers(cl, G, username, user_id, 1, max_depth, visited, retry_count)

            log_and_print(f"[FINI] Réseau exploré jusqu'à la profondeur {max_depth}.")

            # Visualisation (en mode autostart, saute si pas d'interface graphique)
            try:
                plt.figure(figsize=(12, 9))
                pos = nx.spring_layout(G, k=0.5)
                nx.draw(G, pos, with_labels=False, node_size=40, edge_color='gray', alpha=0.6)
                nx.draw_networkx_labels(G, pos, labels={username: username}, font_size=12, font_color='red')
                plt.title(f"Réseau Instagram profondeur {max_depth}")
                plt.axis('off')
                plt.show(block=False)
                plt.pause(10)
                plt.close()
                log_and_print("[INFO] Graphe affiché (mode automatique).")
            except Exception as e:
                log_and_print(f"[INFO] Visualisation sautée : {e}")

            msg = f"Succès ! Réseau Instagram exploré jusqu'à la profondeur {max_depth} pour {username}."
            log_and_print(msg)
            send_notification("Script Instagram : Succès", msg)
            retry_count = 0  # Reset après un succès
            break  # Succès, on sort de la boucle

        except Exception as e:
            # Gestion du "rate limit" ou ban temporaire (HTTP 429)
            if "Please wait a few minutes" in str(e) or "429" in str(e):
                handle_rate_limit(e, retry_count)
                retry_count += 1
            else:
                log_and_print(f"[ERREUR GÉNÉRALE] : {e}")
                send_notification("Script Instagram : ERREUR", str(e))
                time.sleep(wait_on_error)

        log_and_print(f"[INFO] Nouvelle tentative prochainement...\n")

if __name__ == "__main__":
    main()
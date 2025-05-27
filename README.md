# Instagram Network Graph Explorer

Un outil épuré et moderne pour visualiser et explorer les réseaux de followers Instagram en temps réel.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.7+-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

## ✨ Fonctionnalités

- **Visualisation en temps réel** : Le graphe se construit sous vos yeux pendant l'exploration
- **Interface épurée** : Design minimaliste inspiré d'Apple avec mode sombre/clair
- **Exploration multi-niveaux** : Paramétrez la profondeur d'exploration (followers de followers...)
- **Session persistante** : Réutilise automatiquement les sessions Instagram pour éviter les blocages
- **Graphe interactif** : Zoom, déplacement, sélection des nœuds
- **Responsive** : Fonctionne sur desktop et mobile

## 🚀 Installation

### Prérequis
- Python 3.7 ou supérieur
- Un compte Instagram valide

### Étapes d'installation

1. **Clonez le projet**
```bash
git clone https://github.com/Pinpin0909/instagram-network-explorer.git
cd instagram-network-explorer
```

2. **Installez les dépendances**
```bash
pip install flask flask-socketio instagrapi networkx
```

3. **Lancez l'application**
```bash
python app.py
```

4. **Accédez à l'interface**
Ouvrez votre navigateur et allez sur [http://localhost:5000](http://localhost:5000)

## 📋 Utilisation

### Interface utilisateur

1. **Connexion** : Saisissez vos identifiants Instagram dans les champs en haut à gauche
2. **Profondeur** : Choisissez le niveau d'exploration (1-4)
   - **1** : Vos followers uniquement
   - **2** : Vos followers + leurs followers
   - **3** : Et ainsi de suite...
3. **Démarrage** : Cliquez sur "Démarrer" pour lancer l'exploration
4. **Visualisation** : Le graphe se construit en temps réel avec des points discrets représentant les comptes

### Contrôles

- **🌙/☀️** : Basculer entre mode sombre et clair
- **←** : Retour/Reset de l'application
- **Graphe** : Zoomez et déplacez-vous librement dans le réseau

## 🔧 Configuration

### Structure des fichiers
```
instagram-network-explorer/
├── app.py                 # Backend Flask principal
├── templates/
│   └── index.html        # Interface utilisateur
├── static/
│   └── script.js         # Logique frontend
├── README.md
└── *.json               # Sessions Instagram (générées automatiquement)
```

### Sessions Instagram

L'application génère automatiquement des fichiers de session (`username_session.json`) pour :
- Éviter les reconnexions répétées
- Réduire les risques de blocage Instagram
- Améliorer les performances

⚠️ **Important** : Ne partagez jamais ces fichiers de session

## 🛡️ Sécurité et bonnes pratiques

### Recommandations
- Utilisez des délais raisonnables entre les requêtes
- Ne lancez pas plusieurs explorations simultanées
- Respectez les limites d'API d'Instagram
- Utilisez un compte de test si possible

### Gestion des erreurs
- Sessions expirées automatiquement rechargées
- Gestion des comptes privés (ignorés)
- Protection contre les blocages temporaires

## 🎨 Personnalisation

### Modifier l'apparence
Éditez les variables CSS dans `templates/index.html` :
```css
:root {
    --bg: #181a1b;        /* Couleur de fond */
    --text: #f3f3f3;      /* Couleur du texte */
    --node: #bfc5c7;      /* Couleur des nœuds */
    --edge: #33363c;      /* Couleur des liens */
}
```

### Ajuster les paramètres
Modifiez `app.py` pour :
- Changer les délais entre requêtes
- Limiter le nombre de followers récupérés
- Ajouter des filtres personnalisés

## 📊 Technologies utilisées

- **Backend** : Flask, Flask-SocketIO
- **Instagram API** : Instagrapi
- **Graphiques** : NetworkX, Cytoscape.js
- **Frontend** : HTML5, CSS3 (variables), JavaScript (ES6+)
- **Communication temps réel** : WebSockets

## 🤝 Contribution

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le projet
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/nouvelle-fonctionnalite`)
3. Committez vos changements (`git commit -am 'Ajout nouvelle fonctionnalité'`)
4. Poussez vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. Ouvrez une Pull Request

## 📝 Roadmap

- [ ] Export des graphiques (PNG, SVG, JSON)
- [ ] Filtres avancés (par nombre de followers, date...)
- [ ] Analyse de communautés
- [ ] Support des hashtags et mentions
- [ ] Mode comparaison entre comptes
- [ ] Notifications push

## ⚖️ Disclaimer

Cet outil est destiné à des fins éducatives et de recherche. Assurez-vous de respecter :
- Les conditions d'utilisation d'Instagram
- Les lois sur la protection des données
- La vie privée des utilisateurs

L'utilisation de cet outil est sous votre responsabilité.

## 📄 License

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 👤 Auteur

**Pinpin0909**
- GitHub: [@Pinpin0909](https://github.com/Pinpin0909)

## 🙏 Remerciements

- [Instagrapi](https://github.com/adw0rd/instagrapi) pour l'API Instagram
- [Cytoscape.js](https://cytoscape.org/) pour la visualisation de graphes
- [Flask](https://flask.palletsprojects.com/) pour le framework web

---

⭐ N'hésitez pas à mettre une étoile si ce projet vous a été utile !

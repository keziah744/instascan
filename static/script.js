const socket = io();
let cy = null;
let isStarted = false;
let currentMode = localStorage.getItem("colorMode") || "dark";

// Applique le mode au <body>
function applyMode(mode) {
    if(mode === "light") {
        document.body.classList.add("light");
        document.getElementById('toggle-mode-btn').innerText = "☀️";
    } else {
        document.body.classList.remove("light");
        document.getElementById('toggle-mode-btn').innerText = "🌙";
    }
}

// Style épuré, nœuds = points discrets + label
function getNodeStyle(mode) {
    // Récupère les couleurs CSS variables
    const nodeColor = getComputedStyle(document.body).getPropertyValue('--node').trim() || "#bfc5c7";
    const edgeColor = getComputedStyle(document.body).getPropertyValue('--edge').trim() || "#33363c";
    const textColor = getComputedStyle(document.body).getPropertyValue('--text').trim() || "#f3f3f3";
    return [
        {
            selector: "node",
            style: {
                "shape": "ellipse",
                "background-color": nodeColor,
                "border-width": 0,
                "width": 13,
                "height": 13,
                "label": "data(label)",
                "font-family": "Inter, Arial, sans-serif",
                "font-size": "1.03em",
                "color": textColor,
                "text-valign": "center",
                "text-halign": "right",
                "text-margin-x": 16,
                "text-wrap": "wrap",
                "text-max-width": 190,
                "text-background-opacity": 0,
                "text-outline-width": 0,
                "z-compound-depth": "top"
            }
        },
        {
            selector: "edge",
            style: {
                "line-color": edgeColor,
                "width": 1.5,
                "curve-style": "bezier",
                "opacity": 0.6
            }
        }
    ];
}

function initCy() {
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        style: getNodeStyle(currentMode),
        layout: { name: 'cose', animate: true, randomize: true, fit: true, padding: 50 }
    });
    cy.userZoomingEnabled(true);
    cy.userPanningEnabled(true);
    cy.on('tap', 'node', function(evt){
        var node = evt.target;
        cy.elements().removeClass('highlighted');
        node.addClass('highlighted');
    });
}

function updateCyStyle() {
    if (cy) cy.style(getNodeStyle(currentMode));
}

// Ajout/mise à jour du nœud
function addNode(id, label) {
    if(!cy.getElementById(id).length) {
        cy.add({
            group: 'nodes',
            data: { id: id, label: label }
        });
    }
}

// Ajout d'une arête
function addEdge(source, target) {
    if(!cy.edges(`[source = "${source}"][target = "${target}"]`).length) {
        cy.add({ group: 'edges', data: { source: source, target: target } });
    }
}

// Bouton retour = reload complet
document.getElementById('back-btn').onclick = function() {
    window.location.reload();
};

// Bouton toggle mode (dark/light)
document.getElementById('toggle-mode-btn').onclick = function() {
    currentMode = (currentMode === "dark") ? "light" : "dark";
    localStorage.setItem("colorMode", currentMode);
    applyMode(currentMode);
    updateCyStyle();
};

applyMode(currentMode);

// Formulaire de connexion
document.getElementById('loginForm').onsubmit = function(e) {
    e.preventDefault();
    if (isStarted) return;
    isStarted = true;
    document.getElementById('loginForm').style.opacity = 0.4;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=true);
    if (!cy) initCy();
    else updateCyStyle();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const max_depth = document.getElementById('depth').value;
    socket.emit('start_scraping', { username, password, max_depth });
    addNode(username, username);
    cy.center();
};

// Ajout des arêtes/nœuds en temps réel
socket.on('new_edge', function(data) {
    addNode(data.source, data.source);
    addNode(data.target, data.target);
    addEdge(data.source, data.target);
    cy.layout({ name: 'cose', animate: true, randomize: true, fit: true, padding: 50 }).run();
});
socket.on('done', function() {
    document.getElementById('loginForm').style.opacity = 1;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=false);
    isStarted = false;
});
const socket = io();
let isStarted = false;
let currentMode = localStorage.getItem("colorMode") || "dark";

// Variables pour le graphe D3
let svg, simulation, nodes = [], links = [];
let nodeMap = new Map();
let width, height;

// Variables pour la gestion des batch
let pendingNodes = [];
let pendingLinks = [];
let batchTimer = null;
let batchDelay = 500; // Délai en ms pour grouper les ajouts

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

// Fonction pour afficher un message de statut
function showStatusMessage(message, type = 'info') {
    const statusDiv = document.getElementById('status-message');
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
        statusDiv.style.display = 'block';
        
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

// Initialisation du graphe D3
function initGraph() {
    const container = document.getElementById('graph-container');
    width = container.clientWidth;
    height = container.clientHeight;
    
    // Nettoyer le SVG existant
    d3.select('#graph-svg').selectAll('*').remove();
    
    svg = d3.select('#graph-svg')
        .attr('width', width)
        .attr('height', height);
    
    // Créer les groupes pour les liens et les nœuds
    const linkGroup = svg.append('g').attr('class', 'links');
    const nodeGroup = svg.append('g').attr('class', 'nodes');
    const labelGroup = svg.append('g').attr('class', 'labels');
    
    // Configuration de la simulation de forces - Plus stable au départ
    simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(100).strength(0.3))
        .force('charge', d3.forceManyBody().strength(-400).distanceMax(300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30).strength(0.9))
        .force('x', d3.forceX(width / 2).strength(0.05))
        .force('y', d3.forceY(height / 2).strength(0.05))
        .alphaDecay(0.02) // Décroissance plus lente pour stabilité
        .velocityDecay(0.8); // Amortissement pour éviter les oscillations
    
    // Zoom et pan
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            svg.selectAll('g').attr('transform', event.transform);
        });
    
    svg.call(zoom);
    
    // Redimensionnement
    window.addEventListener('resize', () => {
        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('width', width).attr('height', height);
        simulation.force('center', d3.forceCenter(width / 2, height / 2));
        simulation.force('x', d3.forceX(width / 2));
        simulation.force('y', d3.forceY(height / 2));
        simulation.alpha(0.3).restart();
    });
    
    console.log('Graphe D3 initialisé');
}

// Fonction pour calculer une position optimale pour un nouveau nœud
function calculateOptimalPosition(nodeId, connectedNodes) {
    if (connectedNodes.length === 0) {
        // Position aléatoire autour du centre pour les nœuds isolés
        const angle = Math.random() * 2 * Math.PI;
        const radius = 150 + Math.random() * 100;
        return {
            x: width / 2 + Math.cos(angle) * radius,
            y: height / 2 + Math.sin(angle) * radius
        };
    }
    
    // Calculer la position moyenne des nœuds connectés
    let avgX = 0, avgY = 0;
    connectedNodes.forEach(nodeId => {
        const node = nodeMap.get(nodeId);
        if (node) {
            avgX += node.x;
            avgY += node.y;
        }
    });
    
    avgX /= connectedNodes.length;
    avgY /= connectedNodes.length;
    
    // Ajouter un offset aléatoire pour éviter les superpositions
    const offsetAngle = Math.random() * 2 * Math.PI;
    const offsetRadius = 80 + Math.random() * 40;
    
    return {
        x: avgX + Math.cos(offsetAngle) * offsetRadius,
        y: avgY + Math.sin(offsetAngle) * offsetRadius
    };
}

// Fonction pour ajouter un nœud avec position intelligente
function addNodeToBatch(id, label, isMain = false) {
    if (nodeMap.has(id)) return;
    
    // Trouver les nœuds connectés existants
    const connectedNodes = pendingLinks
        .filter(link => link.source === id || link.target === id)
        .map(link => link.source === id ? link.target : link.source)
        .filter(nodeId => nodeMap.has(nodeId));
    
    // Calculer la position optimale
    const position = calculateOptimalPosition(id, connectedNodes);
    
    const node = {
        id: id,
        label: label,
        isMain: isMain,
        x: position.x,
        y: position.y,
        vx: 0, // Vitesse initiale nulle
        vy: 0
    };
    
    pendingNodes.push(node);
}

// Fonction pour ajouter un lien au batch
function addLinkToBatch(sourceId, targetId) {
    // Vérifier si le lien existe déjà
    const linkExists = [...links, ...pendingLinks].some(link => 
        (link.source === sourceId && link.target === targetId) ||
        (link.source === targetId && link.target === sourceId) ||
        (link.source?.id === sourceId && link.target?.id === targetId) ||
        (link.source?.id === targetId && link.target?.id === sourceId)
    );
    
    if (!linkExists) {
        pendingLinks.push({
            source: sourceId,
            target: targetId
        });
    }
}

// Fonction pour traiter le batch
function processBatch() {
    if (pendingNodes.length === 0 && pendingLinks.length === 0) return;
    
    console.log(`Traitement du batch: ${pendingNodes.length} nœuds, ${pendingLinks.length} liens`);
    
    // Ajouter tous les nœuds en attente
    pendingNodes.forEach(node => {
        nodes.push(node);
        nodeMap.set(node.id, node);
    });
    
    // Ajouter tous les liens en attente
    pendingLinks.forEach(link => {
        links.push(link);
    });
    
    // Nettoyer les tableaux en attente
    pendingNodes = [];
    pendingLinks = [];
    
    // Mettre à jour le graphe avec animation
    updateGraphWithAnimation();
}

// Fonction pour programmer le traitement du batch
function scheduleBatchProcessing() {
    if (batchTimer) {
        clearTimeout(batchTimer);
    }
    
    batchTimer = setTimeout(() => {
        processBatch();
        batchTimer = null;
    }, batchDelay);
}

// Fonction pour mettre à jour le graphe avec animation
function updateGraphWithAnimation() {
    if (!simulation) return;
    
    // Mise à jour des liens avec animation d'entrée
    const link = svg.select('.links')
        .selectAll('.link')
        .data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`);
    
    link.exit()
        .transition()
        .duration(300)
        .style('opacity', 0)
        .remove();
    
    link.enter()
        .append('line')
        .attr('class', 'link')
        .style('opacity', 0)
        .transition()
        .duration(500)
        .style('opacity', 0.6);
    
    // Mise à jour des nœuds avec animation d'entrée
    const node = svg.select('.nodes')
        .selectAll('.node')
        .data(nodes, d => d.id);
    
    node.exit()
        .transition()
        .duration(300)
        .attr('r', 0)
        .style('opacity', 0)
        .remove();
    
    const nodeEnter = node.enter()
        .append('circle')
        .attr('class', 'node')
        .attr('r', 0)
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .style('opacity', 0)
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended))
        .on('click', (event, d) => {
            console.log('Nœud cliqué:', d.label);
            highlightNode(event.currentTarget);
        });
    
    // Animation d'apparition des nœuds
    nodeEnter
        .transition()
        .duration(600)
        .attr('r', d => d.isMain ? 8 : 6)
        .style('opacity', 1);
    
    // Mise à jour des labels avec animation
    const label = svg.select('.labels')
        .selectAll('.node-label')
        .data(nodes, d => d.id);
    
    label.exit()
        .transition()
        .duration(300)
        .style('opacity', 0)
        .remove();
    
    const labelEnter = label.enter()
        .append('text')
        .attr('class', d => `node-label ${d.isMain ? 'main' : ''}`)
        .text(d => d.label)
        .attr('dx', 12)
        .attr('dy', 4)
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .style('opacity', 0);
    
    // Animation d'apparition des labels (légèrement retardée)
    labelEnter
        .transition()
        .delay(200)
        .duration(400)
        .style('opacity', 1);
    
    // Mise à jour de la simulation avec une transition douce
    simulation.nodes(nodes);
    simulation.force('link').links(links);
    
    // Relancer la simulation avec moins d'intensité si ce n'est pas le premier démarrage
    const isInitialSetup = nodes.length <= 1;
    simulation.alpha(isInitialSetup ? 0.8 : 0.3).restart();
    
    // Fonction tick pour l'animation
    simulation.on('tick', () => {
        svg.selectAll('.link')
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        svg.selectAll('.node')
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);
        
        svg.selectAll('.node-label')
            .attr('x', d => d.x)
            .attr('y', d => d.y);
    });
}

// Fonction de highlight améliorée
function highlightNode(nodeElement) {
    svg.selectAll('.node').style('opacity', 0.3);
    svg.selectAll('.link').style('opacity', 0.1);
    svg.selectAll('.node-label').style('opacity', 0.3);
    
    d3.select(nodeElement).style('opacity', 1);
    
    setTimeout(() => {
        svg.selectAll('.node').style('opacity', 1);
        svg.selectAll('.link').style('opacity', 0.6);
        svg.selectAll('.node-label').style('opacity', 1);
    }, 2000);
}

// Fonctions de drag améliorées
function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
    d3.select(this).classed('dragging', true);
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
    d3.select(this).classed('dragging', false);
}

// Fonction pour centrer le graphe
function centerGraph() {
    if (!simulation || nodes.length === 0) return;
    
    const zoom = d3.zoom();
    const svg_element = d3.select('#graph-svg');
    
    const centerX = d3.mean(nodes, d => d.x);
    const centerY = d3.mean(nodes, d => d.y);
    
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX, height / 2 - centerY);
    
    svg_element.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Fonction pour relancer la simulation
function restartSimulation() {
    if (simulation) {
        simulation.alpha(1).restart();
    }
}

// Event listeners
document.getElementById('back-btn').onclick = function() {
    window.location.reload();
};

document.getElementById('toggle-mode-btn').onclick = function() {
    currentMode = (currentMode === "dark") ? "light" : "dark";
    localStorage.setItem("colorMode", currentMode);
    applyMode(currentMode);
};

document.getElementById('clear-session-btn').onclick = function() {
    const username = document.getElementById('username').value.trim();
    if (username) {
        socket.emit('clear_session', { username: username });
        showStatusMessage('Demande de nettoyage de session envoyée', 'info');
    } else {
        showStatusMessage('Veuillez entrer un nom d\'utilisateur', 'warning');
    }
};

document.getElementById('center-btn').onclick = centerGraph;
document.getElementById('restart-simulation-btn').onclick = restartSimulation;

// Formulaire de connexion
document.getElementById('loginForm').onsubmit = function(e) {
    e.preventDefault();
    if (isStarted) return;
    
    isStarted = true;
    document.getElementById('loginForm').style.opacity = 0.4;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=true);

    // Réinitialiser
    nodes = [];
    links = [];
    nodeMap.clear();
    pendingNodes = [];
    pendingLinks = [];
    
    if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
    }
    
    if (!simulation) {
        initGraph();
    } else {
        updateGraphWithAnimation();
    }

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const max_depth = document.getElementById('depth').value;

    showStatusMessage('Connexion en cours...', 'info');
    socket.emit('start_scraping', { username, password, max_depth });
    
    // Ajouter le nœud principal immédiatement
    const mainNode = {
        id: username,
        label: username,
        isMain: true,
        x: width / 2,
        y: height / 2,
        vx: 0,
        vy: 0
    };
    
    nodes.push(mainNode);
    nodeMap.set(username, mainNode);
    updateGraphWithAnimation();
    
    console.log("Scraping démarré");
};

// Gestion des événements Socket.IO
socket.on('session_status', function(data) {
    const message = data.reused ? 
        '✅ Session réutilisée - Risque de blocage réduit' : 
        '🔄 Nouvelle connexion établie';
    showStatusMessage(message, data.reused ? 'success' : 'warning');
});

socket.on('session_cleared', function(data) {
    showStatusMessage(`Session supprimée pour ${data.username}`, 'info');
});

socket.on('new_edge', function(data) {
    console.log('Nouvelle arête:', data);
    
    // Ajouter au batch au lieu de traiter immédiatement
    addNodeToBatch(data.source, data.source);
    addNodeToBatch(data.target, data.target);
    addLinkToBatch(data.source, data.target);
    
    // Programmer le traitement du batch
    scheduleBatchProcessing();
});

socket.on('error', function(data) {
    console.error('Erreur:', data);
    showStatusMessage(`❌ Erreur: ${data.message}`, 'error');
    document.getElementById('loginForm').style.opacity = 1;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=false);
    isStarted = false;
});

socket.on('done', function() {
    console.log('Scraping terminé');
    
    // Traiter le dernier batch s'il y en a un
    if (batchTimer) {
        clearTimeout(batchTimer);
        processBatch();
    }
    
    showStatusMessage('✅ Scraping terminé avec succès', 'success');
    document.getElementById('loginForm').style.opacity = 1;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=false);
    isStarted = false;
    
    // Centrer automatiquement à la fin
    setTimeout(centerGraph, 1000);
});

// Initialisation
applyMode(currentMode);
initGraph();
console.log("Application initialisée avec D3.js et système de batch");

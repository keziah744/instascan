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
let batchDelay = 500;

// Variables pour la recherche
let searchInput, searchResults;
let selectedSearchIndex = -1;
let currentSearchResults = [];

// Variables pour l'export/import
let exportModal, importModal;
let importedData = null;
let continueFromImport = false;

// Variables pour la continuation du scraping
let importedMainUser = null;
let scrapedUsers = new Set();

// Variable pour contrôler la stabilité du drag
let isDragging = false;

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

// Mise à jour des statistiques
function updateStats() {
    document.getElementById('node-count').textContent = `${nodes.length} nœud${nodes.length > 1 ? 's' : ''}`;
    document.getElementById('link-count').textContent = `${links.length} lien${links.length > 1 ? 's' : ''}`;
    document.getElementById('search-stats').style.display = nodes.length > 0 ? 'block' : 'none';
}

// === FONCTIONS D'EXPORT (inchangées) ===

function escapeXml(text) {
    if (typeof text !== 'string') text = String(text);
    return text.replace(/[<>&'"]/g, function(c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

function exportToGEXF() {
    const timestamp = new Date().toISOString();
    const creator = "Instagram Network Analyzer";
    
    let gexf = `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://www.gexf.net/1.3" version="1.3" xmlns:viz="http://www.gexf.net/1.3/viz" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.gexf.net/1.3 http://www.gexf.net/1.3/gexf.xsd">
    <meta lastmodifieddate="${timestamp}">
        <creator>${creator}</creator>
        <description>Instagram Network Analysis - Generated on ${new Date().toLocaleDateString()}</description>
    </meta>
    <graph mode="static" defaultedgetype="directed">
        <attributes class="node">
            <attribute id="0" title="type" type="string"/>
            <attribute id="1" title="label" type="string"/>
            <attribute id="2" title="scraped" type="boolean"/>
        </attributes>
        <nodes>`;

    nodes.forEach(node => {
        const size = node.isMain ? 15 : 10;
        const color = node.isMain ? 'ff6b6b' : 'bfc5c7';
        
        gexf += `
            <node id="${escapeXml(node.id)}" label="${escapeXml(node.label)}">
                <attvalues>
                    <attvalue for="0" value="${node.isMain ? 'main' : 'follower'}"/>
                    <attvalue for="1" value="${escapeXml(node.label)}"/>
                    <attvalue for="2" value="${scrapedUsers.has(node.id)}"/>
                </attvalues>
                <viz:size value="${size}"/>
                <viz:position x="${node.x.toFixed(2)}" y="${node.y.toFixed(2)}" z="0"/>
                <viz:color r="${parseInt(color.substr(0,2), 16)}" g="${parseInt(color.substr(2,2), 16)}" b="${parseInt(color.substr(4,2), 16)}"/>
            </node>`;
    });

    gexf += `
        </nodes>
        <edges>`;

    links.forEach((link, index) => {
        const sourceId = link.source.id || link.source;
        const targetId = link.target.id || link.target;
        
        gexf += `
            <edge id="${index}" source="${escapeXml(sourceId)}" target="${escapeXml(targetId)}"/>`;
    });

    gexf += `
        </edges>
    </graph>
</gexf>`;

    return gexf;
}

function exportToGraphML() {
    let graphml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">
    <key id="d0" for="node" attr.name="label" attr.type="string"/>
    <key id="d1" for="node" attr.name="type" attr.type="string"/>
    <key id="d2" for="node" attr.name="x" attr.type="double"/>
    <key id="d3" for="node" attr.name="y" attr.type="double"/>
    <key id="d4" for="node" attr.name="size" attr.type="double"/>
    <key id="d5" for="node" attr.name="scraped" attr.type="boolean"/>
    <graph id="InstagramNetwork" edgedefault="directed">`;

    nodes.forEach(node => {
        const size = node.isMain ? 15 : 10;
        
        graphml += `
        <node id="${escapeXml(node.id)}">
            <data key="d0">${escapeXml(node.label)}</data>
            <data key="d1">${node.isMain ? 'main' : 'follower'}</data>
            <data key="d2">${node.x.toFixed(2)}</data>
            <data key="d3">${node.y.toFixed(2)}</data>
            <data key="d4">${size}</data>
            <data key="d5">${scrapedUsers.has(node.id)}</data>
        </node>`;
    });

    links.forEach((link, index) => {
        const sourceId = link.source.id || link.source;
        const targetId = link.target.id || link.target;
        
        graphml += `
        <edge id="e${index}" source="${escapeXml(sourceId)}" target="${escapeXml(targetId)}"/>`;
    });

    graphml += `
    </graph>
</graphml>`;

    return graphml;
}

function exportToJSON() {
    const exportData = {
        metadata: {
            creator: "Instagram Network Analyzer",
            timestamp: new Date().toISOString(),
            nodes_count: nodes.length,
            edges_count: links.length,
            main_user: importedMainUser || nodes.find(n => n.isMain)?.id,
            scraped_users: Array.from(scrapedUsers)
        },
        nodes: nodes.map(node => ({
            id: node.id,
            label: node.label,
            type: node.isMain ? 'main' : 'follower',
            x: parseFloat(node.x.toFixed(2)),
            y: parseFloat(node.y.toFixed(2)),
            size: node.isMain ? 15 : 10,
            scraped: scrapedUsers.has(node.id)
        })),
        edges: links.map((link, index) => ({
            id: index,
            source: link.source.id || link.source,
            target: link.target.id || link.target,
            type: 'follows'
        }))
    };

    return JSON.stringify(exportData, null, 2);
}

// === NOUVELLES FONCTIONS D'IMPORT ===

function parseJSONFile(content) {
    try {
        const data = JSON.parse(content);
        
        if (!data.nodes || !data.edges) {
            throw new Error('Format JSON invalide : nodes et edges requis');
        }
        
        return {
            nodes: data.nodes.map(node => ({
                id: node.id,
                label: node.label || node.id,
                isMain: node.type === 'main',
                x: node.x || (width / 2 + (Math.random() - 0.5) * 400),
                y: node.y || (height / 2 + (Math.random() - 0.5) * 400),
                vx: 0,
                vy: 0,
                scraped: node.scraped || false
            })),
            edges: data.edges.map(edge => ({
                source: edge.source,
                target: edge.target
            })),
            metadata: data.metadata || {},
            scrapedUsers: data.metadata?.scraped_users || [],
            mainUser: data.metadata?.main_user
        };
    } catch (error) {
        throw new Error(`Erreur de parsing JSON: ${error.message}`);
    }
}

function parseGEXFFile(content) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        
        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error('XML malformé');
        }
        
        const nodes = [];
        const edges = [];
        const scrapedUsers = [];
        let mainUser = null;
        
        // Parser les nœuds
        const nodeElements = xmlDoc.getElementsByTagName('node');
        for (let i = 0; i < nodeElements.length; i++) {
            const nodeEl = nodeElements[i];
            const id = nodeEl.getAttribute('id');
            const label = nodeEl.getAttribute('label') || id;
            
            // Position
            const posEl = nodeEl.getElementsByTagName('viz:position')[0];
            const x = posEl ? parseFloat(posEl.getAttribute('x')) : (width / 2 + (Math.random() - 0.5) * 400);
            const y = posEl ? parseFloat(posEl.getAttribute('y')) : (height / 2 + (Math.random() - 0.5) * 400);
            
            // Attributs
            let isMain = false;
            let scraped = false;
            const attvalues = nodeEl.getElementsByTagName('attvalue');
            for (let j = 0; j < attvalues.length; j++) {
                const att = attvalues[j];
                const attrId = att.getAttribute('for');
                const value = att.getAttribute('value');
                
                if (attrId === '0' && value === 'main') {
                    isMain = true;
                    mainUser = id;
                } else if (attrId === '2' && value === 'true') {
                    scraped = true;
                    scrapedUsers.push(id);
                }
            }
            
            nodes.push({
                id: id,
                label: label,
                isMain: isMain,
                x: x,
                y: y,
                vx: 0,
                vy: 0,
                scraped: scraped
            });
        }
        
        // Parser les arêtes
        const edgeElements = xmlDoc.getElementsByTagName('edge');
        for (let i = 0; i < edgeElements.length; i++) {
            const edgeEl = edgeElements[i];
            edges.push({
                source: edgeEl.getAttribute('source'),
                target: edgeEl.getAttribute('target')
            });
        }
        
        return {
            nodes: nodes,
            edges: edges,
            metadata: {},
            scrapedUsers: scrapedUsers,
            mainUser: mainUser
        };
    } catch (error) {
        throw new Error(`Erreur de parsing GEXF: ${error.message}`);
    }
}

function loadImportedGraph(data, preservePositions, continueScraping) {
    try {
        // Nettoyer le graphe actuel
        nodes = [];
        links = [];
        nodeMap.clear();
        scrapedUsers.clear();
        
        // Charger les données
        data.nodes.forEach(node => {
            if (!preservePositions) {
                node.x = width / 2 + (Math.random() - 0.5) * 400;
                node.y = height / 2 + (Math.random() - 0.5) * 400;
            }
            nodes.push(node);
            nodeMap.set(node.id, node);
            
            if (node.scraped) {
                scrapedUsers.add(node.id);
            }
        });
        
        data.edges.forEach(edge => {
            links.push(edge);
        });
        
        // Configuration pour la continuation
        if (continueScraping) {
            continueFromImport = true;
            importedMainUser = data.mainUser;
            
            // Marquer les utilisateurs scrapés
            data.scrapedUsers.forEach(userId => {
                scrapedUsers.add(userId);
            });
            
            // Pré-remplir le formulaire si possible
            if (importedMainUser) {
                document.getElementById('username').value = importedMainUser;
            }
        }
        
        // Mettre à jour le graphe
        updateGraphWithAnimation();
        updateStats();
        
        // Centrer le graphe
        setTimeout(() => {
            centerGraph();
        }, 1000);
        
        const message = continueScraping ? 
            `✅ Graphe importé (${nodes.length} nœuds, ${links.length} liens) - Prêt à continuer` :
            `✅ Graphe importé (${nodes.length} nœuds, ${links.length} liens)`;
        
        showStatusMessage(message, 'success');
        
    } catch (error) {
        console.error('Erreur lors du chargement:', error);
        showStatusMessage('❌ Erreur lors du chargement du graphe', 'error');
    }
}

// Fonction pour télécharger un fichier
function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Initialisation du modal d'export
function initExportModal() {
    exportModal = document.getElementById('export-modal');
    
    document.querySelectorAll('.export-option').forEach(option => {
        option.addEventListener('click', () => {
            const radio = option.querySelector('input[type="radio"]');
            radio.checked = true;
        });
    });
    
    document.getElementById('export-btn').addEventListener('click', () => {
        if (nodes.length === 0) {
            showStatusMessage('Aucun graphe à exporter', 'warning');
            return;
        }
        exportModal.style.display = 'flex';
    });
    
    document.getElementById('export-cancel').addEventListener('click', () => {
        exportModal.style.display = 'none';
    });
    
    document.getElementById('export-confirm').addEventListener('click', () => {
        const selectedFormat = document.querySelector('input[name="export-format"]:checked').value;
        performExport(selectedFormat);
        exportModal.style.display = 'none';
    });
    
    exportModal.addEventListener('click', (e) => {
        if (e.target === exportModal) {
            exportModal.style.display = 'none';
        }
    });
}

// Initialisation du modal d'import
function initImportModal() {
    importModal = document.getElementById('import-modal');
    const fileInput = document.getElementById('file-input');
    const fileInputHidden = document.getElementById('file-input-hidden');
    const fileInfo = document.getElementById('file-info');
    const continueOptions = document.getElementById('continue-options');
    const importConfirm = document.getElementById('import-confirm');
    
    // Options d'import cliquables
    document.querySelectorAll('.import-option').forEach(option => {
        option.addEventListener('click', () => {
            const radio = option.querySelector('input[type="radio"]');
            radio.checked = true;
        });
    });
    
    // Gestion du clic sur la zone de drop
    fileInput.addEventListener('click', () => {
        fileInputHidden.click();
    });
    
    // Gestion du drag & drop
    fileInput.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileInput.classList.add('drag-over');
    });
    
    fileInput.addEventListener('dragleave', () => {
        fileInput.classList.remove('drag-over');
    });
    
    fileInput.addEventListener('drop', (e) => {
        e.preventDefault();
        fileInput.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelection(files[0]);
        }
    });
    
    // Gestion de la sélection de fichier
    fileInputHidden.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });
    
    function handleFileSelection(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                const extension = file.name.split('.').pop().toLowerCase();
                
                let parsedData;
                if (extension === 'json') {
                    parsedData = parseJSONFile(content);
                } else if (extension === 'gexf') {
                    parsedData = parseGEXFFile(content);
                } else {
                    throw new Error('Format de fichier non supporté');
                }
                
                importedData = parsedData;
                
                // Afficher les informations du fichier
                fileInfo.style.display = 'block';
                fileInfo.innerHTML = `
                    <strong>📄 ${file.name}</strong><br>
                    📊 ${parsedData.nodes.length} nœuds, ${parsedData.edges.length} liens<br>
                    ${parsedData.mainUser ? `👤 Utilisateur principal: ${parsedData.mainUser}` : ''}
                    ${parsedData.scrapedUsers.length > 0 ? `<br>✅ ${parsedData.scrapedUsers.length} utilisateurs déjà scrapés` : ''}
                `;
                
                // Afficher les options de continuation si c'est un JSON avec métadonnées
                if (extension === 'json' && parsedData.mainUser) {
                    continueOptions.style.display = 'block';
                } else {
                    continueOptions.style.display = 'none';
                }
                
                importConfirm.disabled = false;
                
            } catch (error) {
                showStatusMessage(`❌ Erreur: ${error.message}`, 'error');
                fileInfo.style.display = 'none';
                continueOptions.style.display = 'none';
                importConfirm.disabled = true;
            }
        };
        reader.readAsText(file);
    }
    
    // Boutons du modal
    document.getElementById('import-btn').addEventListener('click', () => {
        importModal.style.display = 'flex';
    });
    
    document.getElementById('import-cancel').addEventListener('click', () => {
        importModal.style.display = 'none';
        resetImportModal();
    });
    
    document.getElementById('import-confirm').addEventListener('click', () => {
        if (importedData) {
            const preservePositions = document.getElementById('preserve-positions').checked;
            const continueScraping = document.getElementById('continue-scraping').checked;
            
            loadImportedGraph(importedData, preservePositions, continueScraping);
            importModal.style.display = 'none';
            resetImportModal();
        }
    });
    
    importModal.addEventListener('click', (e) => {
        if (e.target === importModal) {
            importModal.style.display = 'none';
            resetImportModal();
        }
    });
    
    function resetImportModal() {
        importedData = null;
        fileInfo.style.display = 'none';
        continueOptions.style.display = 'none';
        importConfirm.disabled = true;
        fileInputHidden.value = '';
    }
}

// Fonction d'export principale
function performExport(format) {
    let content, filename, contentType;
    
    const timestamp = new Date().toISOString().split('T')[0];
    const mainNode = nodes.find(n => n.isMain);
    const baseName = mainNode ? `instagram_network_${mainNode.label}_${timestamp}` : `instagram_network_${timestamp}`;
    
    switch (format) {
        case 'gexf':
            content = exportToGEXF();
            filename = `${baseName}.gexf`;
            contentType = 'application/xml';
            break;
        case 'graphml':
            content = exportToGraphML();
            filename = `${baseName}.graphml`;
            contentType = 'application/xml';
            break;
        case 'json':
            content = exportToJSON();
            filename = `${baseName}.json`;
            contentType = 'application/json';
            break;
        default:
            showStatusMessage('Format d\'export non supporté', 'error');
            return;
    }
    
    try {
        downloadFile(content, filename, contentType);
        showStatusMessage(`✅ Graphe exporté: ${filename}`, 'success');
        
        if (format === 'gexf') {
            setTimeout(() => {
                showStatusMessage('💡 Ouvrez Gephi et utilisez "Fichier > Ouvrir" pour charger le fichier .gexf', 'info');
            }, 2000);
        } else if (format === 'json') {
            setTimeout(() => {
                showStatusMessage('💡 Utilisez "Importer" pour recharger ce fichier et continuer l\'analyse', 'info');
            }, 2000);
        }
    } catch (error) {
        console.error('Erreur lors de l\'export:', error);
        showStatusMessage('❌ Erreur lors de l\'export', 'error');
    }
}

// Fonction pour vider le graphe
function clearGraph() {
    if (nodes.length === 0) {
        showStatusMessage('Le graphe est déjà vide', 'info');
        return;
    }
    
    if (confirm('Êtes-vous sûr de vouloir vider le graphe ? Cette action est irréversible.')) {
        nodes = [];
        links = [];
        nodeMap.clear();
        scrapedUsers.clear();
        importedMainUser = null;
        continueFromImport = false;
        
        updateGraphWithAnimation();
        updateStats();
        
        showStatusMessage('🗑️ Graphe vidé', 'info');
    }
}

// === RESTE DU CODE (fonctions de recherche, graphe, etc.) ===

// Initialisation de la recherche
function initSearch() {
    searchInput = document.getElementById('search-input');
    searchResults = document.getElementById('search-results');
    
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    searchInput.addEventListener('focus', handleSearchFocus);
    searchInput.addEventListener('blur', handleSearchBlur);
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#search-container')) {
            hideSearchResults();
        }
    });
}

function handleSearchInput(e) {
    const query = e.target.value.trim().toLowerCase();
    selectedSearchIndex = -1;
    
    if (query.length === 0) {
        hideSearchResults();
        clearSearchHighlight();
        return;
    }
    
    currentSearchResults = nodes
        .filter(node => node.label.toLowerCase().includes(query))
        .sort((a, b) => {
            const aLabel = a.label.toLowerCase();
            const bLabel = b.label.toLowerCase();
            
            if (aLabel === query && bLabel !== query) return -1;
            if (bLabel === query && aLabel !== query) return 1;
            if (aLabel.startsWith(query) && !bLabel.startsWith(query)) return -1;
            if (bLabel.startsWith(query) && !aLabel.startsWith(query)) return 1;
            
            return aLabel.localeCompare(bLabel);
        })
        .slice(0, 10);
    
    displaySearchResults();
}

function handleSearchKeydown(e) {
    if (currentSearchResults.length === 0) return;
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedSearchIndex = Math.min(selectedSearchIndex + 1, currentSearchResults.length - 1);
            updateSearchSelection();
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedSearchIndex = Math.max(selectedSearchIndex - 1, -1);
            updateSearchSelection();
            break;
        case 'Enter':
            e.preventDefault();
            if (selectedSearchIndex >= 0) {
                selectSearchResult(currentSearchResults[selectedSearchIndex]);
            } else if (currentSearchResults.length > 0) {
                selectSearchResult(currentSearchResults[0]);
            }
            break;
        case 'Escape':
            e.preventDefault();
            hideSearchResults();
            clearSearchHighlight();
            searchInput.blur();
            break;
    }
}

function handleSearchFocus() {
    if (currentSearchResults.length > 0) {
        showSearchResults();
    }
}

function handleSearchBlur() {
    setTimeout(() => {
        if (!document.querySelector('#search-results:hover')) {
            hideSearchResults();
        }
    }, 200);
}

function displaySearchResults() {
    if (currentSearchResults.length === 0) {
        hideSearchResults();
        return;
    }
    
    const html = currentSearchResults.map((node, index) => `
        <div class="search-result-item ${index === selectedSearchIndex ? 'selected' : ''}" 
             data-index="${index}">
            <div class="search-result-icon ${node.isMain ? 'main' : ''}"></div>
            <div class="search-result-text">${highlightQuery(node.label, searchInput.value)}</div>
        </div>
    `).join('');
    
    searchResults.innerHTML = html;
    
    searchResults.querySelectorAll('.search-result-item').forEach((item, index) => {
        item.addEventListener('click', () => {
            selectSearchResult(currentSearchResults[index]);
        });
    });
    
    showSearchResults();
}

function highlightQuery(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<strong>$1</strong>');
}

function showSearchResults() {
    searchResults.style.display = 'block';
}

function hideSearchResults() {
    searchResults.style.display = 'none';
    selectedSearchIndex = -1;
}

function updateSearchSelection() {
    searchResults.querySelectorAll('.search-result-item').forEach((item, index) => {
        item.classList.toggle('selected', index === selectedSearchIndex);
    });
    
    if (selectedSearchIndex >= 0) {
        const selectedItem = searchResults.children[selectedSearchIndex];
        selectedItem.scrollIntoView({ block: 'nearest' });
    }
}

function selectSearchResult(node) {
    hideSearchResults();
    searchInput.value = node.label;
    
    clearSearchHighlight();
    
    const nodeElement = svg.select('.nodes')
        .selectAll('.node')
        .filter(d => d.id === node.id);
    
    nodeElement.classed('search-highlighted', true);
    
    centerOnNode(node);
    
    showStatusMessage(`Nœud "${node.label}" trouvé et centré`, 'success');
    
    setTimeout(() => {
        clearSearchHighlight();
    }, 3000);
}

function centerOnNode(node) {
    const zoom = d3.zoom();
    const svg_element = d3.select('#graph-svg');
    
    const scale = 1.5;
    const transform = d3.zoomIdentity
        .translate(width / 2 - node.x * scale, height / 2 - node.y * scale)
        .scale(scale);
    
    svg_element.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

function clearSearchHighlight() {
    svg.selectAll('.node').classed('search-highlighted', false);
}

function clearSearch() {
    searchInput.value = '';
    hideSearchResults();
    clearSearchHighlight();
    currentSearchResults = [];
    searchInput.focus();
}

// INITIALISATION DU GRAPHE AVEC STABILITÉ AMÉLIORÉE
function initGraph() {
    const container = document.getElementById('graph-container');
    width = container.clientWidth;
    height = container.clientHeight;
    
    d3.select('#graph-svg').selectAll('*').remove();
    
    svg = d3.select('#graph-svg')
        .attr('width', width)
        .attr('height', height);
    
    const linkGroup = svg.append('g').attr('class', 'links');
    const nodeGroup = svg.append('g').attr('class', 'nodes');
    const labelGroup = svg.append('g').attr('class', 'labels');
    
    // PARAMÈTRES OPTIMISÉS POUR LA STABILITÉ LORS DU DRAG
    simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id)
            .distance(180)        
            .strength(0.1))       // RÉDUIT à 0.1 pour éviter les réactions en chaîne
        .force('charge', d3.forceManyBody()
            .strength(-600)       // RÉDUIT à -600 pour moins de force
            .distanceMax(400))    // RÉDUIT à 400 pour limiter l'influence
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide()
            .radius(50)           
            .strength(0.8))       // RÉDUIT à 0.8 pour moins de rigidité
        .force('x', d3.forceX(width / 2).strength(0.02))  // RÉDUIT à 0.02
        .force('y', d3.forceY(height / 2).strength(0.02)) // RÉDUIT à 0.02
        .alphaDecay(0.03)        // AUGMENTÉ à 0.03 pour stabilisation plus rapide
        .velocityDecay(0.9);     // AUGMENTÉ à 0.9 pour plus de freinage
    
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            svg.selectAll('g').attr('transform', event.transform);
        });
    
    svg.call(zoom);
    
    window.addEventListener('resize', () => {
        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('width', width).attr('height', height);
        simulation.force('center', d3.forceCenter(width / 2, height / 2));
        simulation.force('x', d3.forceX(width / 2));
        simulation.force('y', d3.forceY(height / 2));
        simulation.alpha(0.3).restart();
    });
    
    console.log('Graphe D3 initialisé avec stabilité optimisée');
}

function calculateOptimalPosition(nodeId, connectedNodes) {
    if (connectedNodes.length === 0) {
        const angle = Math.random() * 2 * Math.PI;
        const radius = 200 + Math.random() * 200;
        return {
            x: width / 2 + Math.cos(angle) * radius,
            y: height / 2 + Math.sin(angle) * radius
        };
    }
    
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
    
    const offsetAngle = Math.random() * 2 * Math.PI;
    const offsetRadius = 120 + Math.random() * 80;
    
    return {
        x: avgX + Math.cos(offsetAngle) * offsetRadius,
        y: avgY + Math.sin(offsetAngle) * offsetRadius
    };
}

function addNodeToBatch(id, label, isMain = false) {
    if (nodeMap.has(id)) return;
    
    const connectedNodes = pendingLinks
        .filter(link => link.source === id || link.target === id)
        .map(link => link.source === id ? link.target : link.source)
        .filter(nodeId => nodeMap.has(nodeId));
    
    const position = calculateOptimalPosition(id, connectedNodes);
    
    const node = {
        id: id,
        label: label,
        isMain: isMain,
        x: position.x,
        y: position.y,
        vx: 0,
        vy: 0
    };
    
    pendingNodes.push(node);
}

function addLinkToBatch(sourceId, targetId) {
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

function processBatch() {
    if (pendingNodes.length === 0 && pendingLinks.length === 0) return;
    
    console.log(`Traitement du batch: ${pendingNodes.length} nœuds, ${pendingLinks.length} liens`);
    
    pendingNodes.forEach(node => {
        nodes.push(node);
        nodeMap.set(node.id, node);
    });
    
    pendingLinks.forEach(link => {
        links.push(link);
    });
    
    pendingNodes = [];
    pendingLinks = [];
    
    updateGraphWithAnimation();
    updateStats();
}

function scheduleBatchProcessing() {
    if (batchTimer) {
        clearTimeout(batchTimer);
    }
    
    batchTimer = setTimeout(() => {
        processBatch();
        batchTimer = null;
    }, batchDelay);
}

function updateGraphWithAnimation() {
    if (!simulation) return;
    
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
            searchInput.value = d.label;
            highlightNode(event.currentTarget);
        });
    
    nodeEnter
        .transition()
        .duration(600)
        .attr('r', d => d.isMain ? 8 : 6)
        .style('opacity', 1);
    
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
    
    labelEnter
        .transition()
        .delay(200)
        .duration(400)
        .style('opacity', 1);
    
    simulation.nodes(nodes);
    simulation.force('link').links(links);
    
    const isInitialSetup = nodes.length <= 1;
    simulation.alpha(isInitialSetup ? 0.8 : 0.3).restart();
    
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

// FONCTIONS DE DRAG OPTIMISÉES POUR LA STABILITÉ
function dragstarted(event, d) {
    isDragging = true;
    
    // Réduire fortement l'alpha pendant le drag pour minimiser les perturbations
    if (!event.active) simulation.alphaTarget(0.1).restart();
    
    d.fx = d.x;
    d.fy = d.y;
    d3.select(this).classed('dragging', true);
    
    // Réduire temporairement les forces pour éviter les réactions en chaîne
    simulation.force('charge').strength(-200);
    simulation.force('link').strength(0.05);
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    isDragging = false;
    
    // Arrêter complètement la simulation après le drag
    if (!event.active) simulation.alphaTarget(0);
    
    d.fx = null;
    d.fy = null;
    d3.select(this).classed('dragging', false);
    
    // Restaurer les forces après un délai
    setTimeout(() => {
        if (!isDragging) {  // Seulement si on n'est pas en train de dragger autre chose
            simulation.force('charge').strength(-600);
            simulation.force('link').strength(0.1);
            
            // Relancer brièvement la simulation pour stabiliser
            simulation.alpha(0.1).restart();
        }
    }, 500);
}

function centerGraph() {
    if (!simulation || nodes.length === 0) return;
    
    const zoom = d3.zoom();
    const svg_element = d3.select('#graph-svg');
    
    const centerX = d3.mean(nodes, d => d.x);
    const centerY = d3.mean(nodes, d => d.y);
    
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX, width / 2 - centerY);
    
    svg_element.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

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
document.getElementById('clear-search-btn').onclick = clearSearch;
document.getElementById('clear-graph-btn').onclick = clearGraph;

// Formulaire de connexion avec support de continuation
document.getElementById('loginForm').onsubmit = function(e) {
    e.preventDefault();
    if (isStarted) return;

    // Validation : pseudo obligatoire, et mot de passe OU sessionid
    const uCheck = document.getElementById('username').value.trim();
    const pCheck = document.getElementById('password').value;
    const sCheck = document.getElementById('sessionid').value.trim();
    if (!uCheck) {
        showStatusMessage("Entre ton nom d'utilisateur Instagram", 'warning');
        return;
    }
    if (!pCheck && !sCheck) {
        showStatusMessage('Entre ton mot de passe OU ton sessionid', 'warning');
        return;
    }

    isStarted = true;
    document.getElementById('loginForm').style.opacity = 0.4;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=true);

    // Si on continue depuis un import, ne pas nettoyer le graphe
    if (!continueFromImport) {
        nodes = [];
        links = [];
        nodeMap.clear();
        scrapedUsers.clear();
    }
    
    pendingNodes = [];
    pendingLinks = [];
    currentSearchResults = [];
    clearSearch();
    
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
    const sessionid = document.getElementById('sessionid').value.trim();
    const max_depth = document.getElementById('depth').value;

    showStatusMessage(sessionid ? 'Connexion via sessionid...' : 'Connexion en cours...', 'info');

    // Envoyer les informations de continuation si applicable
    const scrapingData = {
        username,
        password,
        sessionid,
        max_depth,
        continue_from_import: continueFromImport,
        scraped_users: continueFromImport ? Array.from(scrapedUsers) : []
    };
    
    socket.emit('start_scraping', scrapingData);
    
    // Ajouter le nœud principal seulement s'il n'existe pas déjà
    if (!nodeMap.has(username)) {
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
    }
    
    // Marquer l'utilisateur principal comme scrapé
    scrapedUsers.add(username);
    updateStats();
    
    console.log(continueFromImport ? "Continuation du scraping" : "Nouveau scraping démarré");
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
    
    // Ne pas ajouter si on a déjà scrapé cet utilisateur (pour la continuation)
    if (continueFromImport && scrapedUsers.has(data.source)) {
        console.log(`Utilisateur ${data.source} déjà scrapé, passage...`);
        return;
    }
    
    addNodeToBatch(data.source, data.source);
    addNodeToBatch(data.target, data.target);
    addLinkToBatch(data.source, data.target);
    
    // Marquer l'utilisateur source comme scrapé
    scrapedUsers.add(data.source);
    
    scheduleBatchProcessing();
});

socket.on('error', function(data) {
    console.error('Erreur:', data);
    const detail = (data.error && data.error !== data.message) ? `  —  ${data.error}` : '';
    showStatusMessage(`❌ ${data.message}${detail}`, 'error');
    // Ferme la fenêtre 2FA si elle était ouverte
    document.getElementById('twofa-modal').style.display = 'none';
    document.getElementById('loginForm').style.opacity = 1;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=false);
    isStarted = false;
});

socket.on('done', function() {
    console.log('Scraping terminé');
    
    if (batchTimer) {
        clearTimeout(batchTimer);
        processBatch();
    }
    
    const message = continueFromImport ? 
        '✅ Continuation du scraping terminée avec succès' :
        '✅ Scraping terminé avec succès';
    
    showStatusMessage(message, 'success');
    document.getElementById('loginForm').style.opacity = 1;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=false);
    isStarted = false;
    
    // Réinitialiser le flag de continuation
    continueFromImport = false;
    
    setTimeout(centerGraph, 1000);
});

// --- Double authentification (2FA) / challenge Instagram ---
let twofaUsername = null;

function closeTwofaModal() {
    document.getElementById('twofa-modal').style.display = 'none';
    document.getElementById('twofa-code').value = '';
}

function submitTwofaCode() {
    const code = document.getElementById('twofa-code').value.trim();
    if (!code) {
        showStatusMessage('Veuillez entrer le code de vérification', 'warning');
        return;
    }
    socket.emit('submit_2fa', { username: twofaUsername, code: code });
    closeTwofaModal();
    showStatusMessage('🔐 Vérification du code en cours...', 'info');
}

socket.on('need_2fa', function(data) {
    twofaUsername = data.username;
    const isChallenge = data.reason && data.reason.indexOf('challenge') === 0;
    document.getElementById('twofa-message').textContent = isChallenge
        ? "Instagram demande une vérification. Entrez le code reçu par email ou SMS."
        : "Entrez le code de double authentification (application d'authentification ou SMS).";
    document.getElementById('twofa-code').value = '';
    document.getElementById('twofa-modal').style.display = 'flex';
    document.getElementById('twofa-code').focus();
    showStatusMessage('🔐 Code de vérification requis', 'warning');
});

document.getElementById('twofa-confirm').onclick = submitTwofaCode;

document.getElementById('twofa-code').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        submitTwofaCode();
    }
});

document.getElementById('twofa-cancel').onclick = function() {
    // Débloque le backend avec un code vide : le login échouera proprement.
    socket.emit('submit_2fa', { username: twofaUsername, code: '' });
    closeTwofaModal();
    showStatusMessage('Connexion annulée', 'info');
    document.getElementById('loginForm').style.opacity = 1;
    document.getElementById('loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=false);
    isStarted = false;
};

// Initialisation
applyMode(currentMode);
initGraph();
initSearch();
initExportModal();
initImportModal();
updateStats();
console.log("Application initialisée avec D3.js, système de batch, recherche, export/import et stabilité optimisée");
console.log("%c[instascan build: 2fa-v2]", "color:#38ef7d;font-weight:bold");

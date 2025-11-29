// ludo-client.js

document.addEventListener('DOMContentLoaded', function() {

    // Conectar al mismo servidor (namespace por defecto para sincronización correcta)
    const socket = io();
    
    // Obtener el ID de la sala desde la URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('roomId');
    
    if (!roomId) {
        alert('Error: No se encontró ID de la sala.');
        window.location.href = '/'; // Devolver al lobby
    }
    
    // Estado del juego
    let gameState = null;
    let currentPlayer = null;
    let myPlayerId = null;
    let diceAnimationInterval = null; // <-- AÑADE ESTA LÍNEA
    // ▼▼▼ AÑADE ESTAS LÍNEAS (BANDERAS PARA PENALIZACIÓN) ▼▼▼
    let isFoulPenaltyVisualizing = false;
    let penalizedPieceIdDuringFoul = null;
    let foulKillingPosition = -1; // Guardará la casilla donde estaba la ficha penalizada
    // ▲▲▲ FIN ▲▲▲

    // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
    let activeAnimationPromise = Promise.resolve(); // Para sincronizar la animación final y el modal de victoria
    // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

    // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
    let unreadMessageCount = 0; // Contador para notificaciones de chat
    // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

    // ▼▼▼ AÑADE ESTOS SELECTORES ▼▼▼
    const btnStartGame = document.getElementById('btn-start-game');
    const gamePotDisplay = document.getElementById('game-pot');
    const myDiceContainer = document.getElementById('player-dice-container-yellow'); // Ya existe
    // ▲▲▲ FIN DE LOS SELECTORES ▲▲▲

    // Constantes de los slots físicos del HTML
    // (El orden es el sentido horario desde la base del jugador local)
    const PHYSICAL_SLOTS = ['yellow', 'green', 'red', 'blue'];
    
    // Variable para controlar si el sonido está silenciado
    // Sincroniza con localStorage para compartir el estado con ludogame.js
    function getIsMuted() {
        return localStorage.getItem('la51_sound_muted') === 'true';
    }
    
    // Pool de audio para 'tag' (solo para iOS - permite reproducciones simultáneas)
    const TAG_POOL_SIZE = 10;
    let tagAudioPool = [];
    let tagAudioPoolIndex = 0;
    
    // Inicializar pool de audio para tag
    function initTagAudioPool() {
        const soundContainer = document.getElementById('game-sounds');
        if (!soundContainer) return;
        
        const originalTag = document.getElementById('sound-tag');
        if (!originalTag) return;
        
        const poolSize = TAG_POOL_SIZE; // Usar variable local para evitar problemas de scope
        for (let i = 0; i < poolSize; i++) {
            const audioClone = originalTag.cloneNode(true);
            audioClone.id = `sound-tag-pool-${i}`;
            soundContainer.appendChild(audioClone);
            tagAudioPool.push(audioClone);
        }
    }
    
    // Función para reproducir sonidos
    function playSound(soundId) {
        if (getIsMuted()) return;
        
        try {
            // Para 'tag', usar pool (para iOS)
            if (soundId === 'tag') {
                if (tagAudioPool.length === 0) {
                    initTagAudioPool();
                }
                
                if (tagAudioPool.length > 0) {
                    const audioElement = tagAudioPool[tagAudioPoolIndex];
                    tagAudioPoolIndex = (tagAudioPoolIndex + 1) % tagAudioPool.length;
                    audioElement.pause();
                    audioElement.currentTime = 0;
                    const playPromise = audioElement.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {
                            console.warn(`[Audio] No se pudo reproducir 'tag' (pool):`, error.name);
                        });
                    }
                    return;
                }
            }
            
            // Para otros sonidos, método normal
            const soundElement = document.getElementById(`sound-${soundId}`);
            if (soundElement) {
                soundElement.pause();
                soundElement.currentTime = 0;
                const playPromise = soundElement.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.warn(`[Audio] No se pudo reproducir '${soundId}':`, error.name);
                    });
                }
            }
        } catch (error) {
            console.warn(`No se pudo reproducir el sonido: ${soundId}`, error);
        }
    }
    
    /**
     * Función de ayuda para rotar un array.
     * Mueve 'offset' elementos del principio al final.
     */
    function rotateArray(arr, offset) {
        if (!arr || arr.length === 0) return [];
        const validOffset = (offset % arr.length + arr.length) % arr.length; // Maneja offsets negativos
        return [...arr.slice(validOffset), ...arr.slice(0, validOffset)];
    }

    /**
     * Actualiza todas las cajas de información de jugadores sin re-renderizar el tablero.
     * @param {Array} seats - Array de asientos del servidor.
     */
    function updatePlayerInfoBoxes(seats) {
        if (!seats || !gameState) return;
        
        // Mapeo de asientos físicos a colores de cajas de información
        // CORRECCIÓN: PHYSICAL_SLOTS debe coincidir con el colorMap del servidor: ['red', 'blue', 'yellow', 'green']
        const PHYSICAL_SLOTS = ['red', 'blue', 'yellow', 'green'];
        
        for (let i = 0; i < 4; i++) {
            const slotColor = PHYSICAL_SLOTS[i];
            const player = seats[i];
            updatePlayerInfoBox(slotColor, player);
        }
    }

    /**
     * Actualiza la caja de información de un jugador.
     * @param {string} slotColor - El color del slot físico ('yellow', 'green', 'red', 'blue').
     * @param {object} player - El objeto del jugador (o null si está vacío).
     */
    function updatePlayerInfoBox(slotColor, player) {
        const infoBox = document.getElementById(`player-info-box-${slotColor}`);
        if (!infoBox) return;

        if (player) {
            infoBox.style.visibility = 'visible';
            const playerNameEl = infoBox.querySelector('.player-name');
            const avatarEl = infoBox.querySelector('.player-avatar');
            
            if (playerNameEl) {
                playerNameEl.textContent = player.playerName || `Jugador ${slotColor}`;
            }
            
            if (avatarEl) {
                // Usar avatar del jugador, o avatar_url como fallback, o avatar por defecto
                const avatarUrl = player.avatar || player.avatar_url || '';
                if (avatarUrl && avatarUrl.trim() !== '') {
                    avatarEl.src = avatarUrl;
                    avatarEl.alt = `Avatar de ${player.playerName || slotColor}`;
                } else {
                    // Avatar por defecto basado en el color del slot
                    const defaultAvatarIndex = (['yellow', 'green', 'red', 'blue'].indexOf(slotColor) % 10) + 1;
                    avatarEl.src = `https://i.pravatar.cc/150?img=${defaultAvatarIndex}`;
                    avatarEl.alt = `Avatar por defecto de ${slotColor}`;
                }
                // Forzar recarga de la imagen si es la misma URL
                avatarEl.onerror = function() {
                    const defaultAvatarIndex = (['yellow', 'green', 'red', 'blue'].indexOf(slotColor) % 10) + 1;
                    this.src = `https://i.pravatar.cc/150?img=${defaultAvatarIndex}`;
                };
            }
        } else {
            infoBox.style.visibility = 'hidden';
            const playerNameEl = infoBox.querySelector('.player-name');
            const avatarEl = infoBox.querySelector('.player-avatar');
            
            if (playerNameEl) {
                playerNameEl.textContent = `Jugador ${slotColor}`;
            }
            
            if (avatarEl) {
                // Avatar por defecto cuando no hay jugador
                const defaultAvatarIndex = (['yellow', 'green', 'red', 'blue'].indexOf(slotColor) % 10) + 1;
                avatarEl.src = `https://i.pravatar.cc/150?img=${defaultAvatarIndex}`;
            }
        }
    }
    
    /**
     * Renderiza el tablero, rotando la vista con CSS y actualizando las cajas de info.
     * @param {object} state - El estado completo del juego.
     */
    function renderLudoBoard(state) {
        console.log('Renderizando tablero de Ludo (CON ROTACIÓN CSS):', state);
        if (!state || !state.settings || !state.settings.colorMap) {
            console.warn('Estado inválido, no se rota el tablero.');
            return;
        }
        
        // CORRECCIÓN: Permitir renderizado para jugadores con mySeatIndex válido (0-3)
        // Si mySeatIndex es -1, usar 0 como fallback para espectadores
        if (state.mySeatIndex == null || state.mySeatIndex < 0 || state.mySeatIndex > 3) {
            console.warn('mySeatIndex inválido, usando fallback 0 para espectador.');
            state.mySeatIndex = 0;
        }

        // ▼▼▼ INICIO DE LA MODIFICACIÓN (LÓGICA CORREGIDA) ▼▼▼
        const { seats, mySeatIndex, settings } = state;

        // 1. Obtener el color del asiento físico en el que estoy
        const myColor = settings.colorMap[mySeatIndex];

        // 2. Calcular la rotación CSS basada en el ASIENTO FÍSICO (mySeatIndex),
        //    no en el color (que ahora es variable).
        // El objetivo es que MI asiento (mySeatIndex) siempre rote para
        // quedar en la posición del Asiento 0 (amarillo, abajo-derecha).
        let rotationDegrees = 0;

        switch (mySeatIndex) {
            case 0: // Estoy en el asiento 0 (Yellow / Abajo-Derecha)
                rotationDegrees = 0; 
                break;
            case 3: // Estoy en el asiento 3 (Blue / Arriba-Derecha)
                rotationDegrees = 90; // Gira 90deg para mover el slot Azul a la posición Amarilla
                break;
            case 2: // Estoy en el asiento 2 (Red / Arriba-Izquierda)
                rotationDegrees = 180; // Gira 180deg
                break;
            case 1: // Estoy en el asiento 1 (Green / Abajo-Izquierda)
                rotationDegrees = -90; // Gira -90deg
                break;
        }
        // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲

        // 3. Aplicar la rotación CSS SOLAMENTE al tablero
        //    (NO al contenedor, para que las cajas de info queden fijas)
        const boardElement = document.getElementById('ludo-board'); // <-- ID CAMBIADO
        if (boardElement) {
            boardElement.style.transform = `rotate(${rotationDegrees}deg)`;
            // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
            boardElement.dataset.rotation = rotationDegrees;
            // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
            
            // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
            // Almacena la rotación INVERSA como una variable CSS en el tablero
            boardElement.style.setProperty('--board-counter-rotation', `${-rotationDegrees}deg`);
            // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

            // (Opcional) Añadimos una transición suave
            boardElement.style.transition = 'transform 0.5s ease-out';
        } else {
            console.error('¡No se encontró #ludo-board!'); // <-- ID CAMBIADO
        }
        
        // 4. Rotar los datos de los jugadores para las cajas de info
        // (Esta lógica sigue siendo correcta: rota el array de asientos para que TU
        // información siempre se muestre en la caja física 'yellow' de abajo-derecha)
        const rotationOffset = mySeatIndex;
        const rotatedSeats = rotateArray(seats, rotationOffset);

        console.log(`Soy Asiento ${mySeatIndex} (Color ${myColor}). Rotando tablero ${rotationDegrees}deg.`);

        // 5. Aplicar los datos de los jugadores a los slots físicos (sin cambiar colores)
        for (let i = 0; i < PHYSICAL_SLOTS.length; i++) {
            const physicalSlot = PHYSICAL_SLOTS[i]; // 'yellow', 'green', 'red', 'blue'
            const player = rotatedSeats[i];         // El jugador que va en ese slot

            // Actualizar la info del jugador para este slot
            updatePlayerInfoBox(physicalSlot, player);
            
            // NO LLAMAMOS a updateBoardColors()
        }

        updatePairLabels(state);
    }

    // ▼▼▼ AÑADE ESTA NUEVA FUNCIÓN ▼▼▼
    /**
     * Dibuja las fichas que están en la base.
     * @param {object} piecesState - El objeto gameState.pieces del servidor.
     */
    function renderBasePieces(piecesState) {
        if (!piecesState || !gameState || !gameState.seats || !gameState.settings || !gameState.settings.colorMap) return;

        const seats = gameState.seats;
        const colorMap = gameState.settings.colorMap;

        // Itera sobre cada color definido en el estado de las fichas
        for (const color in piecesState) {
            const container = document.getElementById(`base-pieces-${color}`);
            if (!container) continue; // Si el contenedor no existe, salta

            const seatIndex = colorMap.indexOf(color);
            const playerInSeat = (seatIndex !== -1) ? seats[seatIndex] : null;
            let shouldRender = false;
            if (playerInSeat && gameState) {
                if (gameState.state === 'waiting' && playerInSeat.status === 'waiting') {
                    shouldRender = true;
                }
                else if ((gameState.state === 'playing' || gameState.state === 'post-game') && playerInSeat.status === 'playing') {
                    shouldRender = true;
                }
            }

            container.innerHTML = '';

            if (shouldRender) {
                const basePieces = piecesState[color].filter(piece => piece.state === 'base');

                basePieces.forEach(piece => {
                    const pieceElement = document.createElement('div');
                    pieceElement.className = `ludo-piece in-base ${color}`;
                    pieceElement.id = piece.id; // Asigna el ID (ej: "yellow-1")
                    container.appendChild(pieceElement);
                });
            }
        }
    }
    // ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲

    // ▼▼▼ AÑADE ESTAS TRES NUEVAS FUNCIONES ▼▼▼

    /**
     * Dibuja las fichas que están "activas" (en el tablero), mostrando solo una por color con contador.
     * @param {object} piecesState - El objeto gameState.pieces del servidor.
     */
    function renderActivePieces(piecesState) {
        if (!piecesState || !gameState || !gameState.seats || !gameState.settings || !gameState.settings.colorMap) return;

        // ▼▼▼ INICIO: Helper (BASADO EN TUS LISTAS MANUALES) ▼▼▼
        /**
         * Determina la orientación visual (vertical/horizontal) de una casilla
         * según la rotación del tablero, usando las listas manuales.
         */
        function getVisualOrientation(posNum, rotation) {
            // Listas de casillas (path) VISUALMENTE verticales en Rotación 0°
            const verticalPaths_R0 = [
                1, 2, 3, 4, 5, 6, 7, 8, // Inferior (Amarillo)
                60, 61, 62, 63, 64, 65, 66, 67, 68,
                26, 27, 28, 29, 30, 31, 32, 33, 34, // Superior (Rojo)
                35, 36, 37, 38, 39, 40, 41, 42,
                69, 70, 71, 72, 73, 74, 75, 110, // Meta Amarilla
                83, 84, 85, 86, 87, 88, 89, 99 // Meta Roja
            ];

            // Listas de casillas (path) VISUALMENTE horizontales en Rotación 0°
            const horizontalPaths_R0 = [
                43, 44, 45, 46, 47, 48, 49, 50, 51, // Izquierdo (Verde)
                52, 53, 54, 55, 56, 57, 58, 59,
                9, 10, 11, 12, 13, 14, 15, 16, 17, // Derecho (Azul)
                18, 19, 20, 21, 22, 23, 24, 25,
                90, 91, 92, 93, 94, 95, 96, 102, // Meta Verde
                76, 77, 78, 79, 80, 81, 82, 107 // Meta Azul
            ];

            let isVertical;
            posNum = parseInt(posNum, 10); // Asegurarse de que sea un número

            if (rotation === 0 || rotation === 180) {
                // En 0° y 180°, la orientación visual es la misma que la base (R0)
                isVertical = verticalPaths_R0.includes(posNum);
            } else {
                // En 90° y -90°, la orientación se invierte
                // Lo que era R0 Horizontal (Verde/Azul) ahora es Vertical
                isVertical = horizontalPaths_R0.includes(posNum);
            }

            return isVertical ? 'vertical' : 'horizontal';
        }
        // ▲▲▲ FIN: Helper ▲▲▲

        // ▼▼▼ INSERCIÓN 1: Leer la rotación actual del tablero ▼▼▼
        const boardElement = document.getElementById('ludo-board');
        const boardRotation = boardElement ? parseInt(boardElement.dataset.rotation || 0) : 0;
        // ▲▲▲ FIN INSERCIÓN 1 ▲▲▲

        // ▼▼▼ INSERCIÓN 1: Limpiar bloqueos anteriores al redibujar ▼▼▼
        document.querySelectorAll('.blocked-cell').forEach(el => el.classList.remove('blocked-cell'));
        // ▲▲▲ FIN INSERCIÓN 1 ▲▲▲

        // ▼▼▼ INSERCIÓN 1B: Restaurar iconos de casillas especiales ▼▼▼
        document.querySelectorAll('.hide-icon').forEach(el => el.classList.remove('hide-icon'));
        // ▲▲▲ FIN INSERCIÓN 1B ▲▲▲

        // 1. Limpia todas las fichas activas antiguas
        document.querySelectorAll('.ludo-piece.active').forEach(p => p.remove());

        // 2. Contenedor para fichas en celdas SVG (meta)
        const svgPiecesContainer = document.getElementById('board-cells');
        const boardRect = svgPiecesContainer.getBoundingClientRect();

        const seats = gameState.seats;
        const colorMap = gameState.settings.colorMap;
        const gameType = gameState?.settings?.gameType || 'ludo'; // 'ludo' o 'parchis'
        const boardRules = gameState?.gameState?.board;
        const goalPositions = boardRules?.goal ? Object.values(boardRules.goal).map(Number) : [];
        const homeStretchEntries = boardRules?.home_stretch ? Object.entries(boardRules.home_stretch) : [];

        // 3. Agrupa las fichas por posición
        const piecesByPosition = {};
        for (const color in piecesState) {
            const seatIndex = colorMap.indexOf(color);
            const playerInSeat = (seatIndex !== -1) ? seats[seatIndex] : null;
            let shouldRender = false;
            if (playerInSeat && gameState) {
                if (gameState.state === 'waiting' && playerInSeat.status === 'waiting') {
                    shouldRender = true;
                }
                else if ((gameState.state === 'playing' || gameState.state === 'post-game') && playerInSeat.status === 'playing') {
                    shouldRender = true;
                }
            }

            if (!shouldRender) {
                continue;
            }

            const activePieces = piecesState[color].filter(piece => piece.state === 'active');
            activePieces.forEach(piece => {
                const pos = piece.position;
                if (!piecesByPosition[pos]) {
                    piecesByPosition[pos] = [];
                }
                piecesByPosition[pos].push(piece);
            });
        }

        // (Lógica de visualización de falta - sin cambios)
        if (isFoulPenaltyVisualizing && penalizedPieceIdDuringFoul !== null && foulKillingPosition !== -1) {
            let penalizedPieceData = null;
            for (const c in piecesState) {
                const found = piecesState[c].find(p => p.id === penalizedPieceIdDuringFoul);
                if (found) {
                    penalizedPieceData = found;
                    break;
                }
            }
            if (penalizedPieceData) {
                const cellElement = document.querySelector(`[data-cell="${foulKillingPosition}"]`);
                if (cellElement) {
                    console.log(`[FALTA RENDER] Forzando visualización de ${penalizedPieceIdDuringFoul} en ${foulKillingPosition}`);
                    const isSvgCell = !(cellElement.tagName.toLowerCase() === 'div' && cellElement.classList.contains('cell'));
                    const boardRect = svgPiecesContainer.getBoundingClientRect();
                    const pieceElement = document.createElement('div');
                    pieceElement.className = `ludo-piece active ${penalizedPieceData.color}`;
                    pieceElement.id = penalizedPieceData.id;
                    pieceElement.style.pointerEvents = 'none'; 
                    if (!isSvgCell) {
                        pieceElement.style.transform = `translate(-50%, -50%)`; 
                        cellElement.appendChild(pieceElement);
                    } else {
                        const cellRect = cellElement.getBoundingClientRect();
                        pieceElement.style.position = 'absolute';
                        pieceElement.style.left = `${cellRect.left + (cellRect.width / 2) - boardRect.left}px`;
                        pieceElement.style.top = `${cellRect.top + (cellRect.height / 2) - boardRect.top}px`;
                        svgPiecesContainer.appendChild(pieceElement);
                    }
                }
            }
        }

        // 4. Itera sobre las posiciones ocupadas
        for (const position in piecesByPosition) {
            const allPiecesInCell = piecesByPosition[position]; // Array de TODAS las fichas
            const cell = document.querySelector(`[data-cell="${position}"]`);
            if (!cell) {
                console.warn(`No se encontró la celda [data-cell="${position}"]`);
                continue;
            }

            // ▼▼▼ INSERCIÓN 2: Ocultar icono si hay fichas ▼▼▼
            if (allPiecesInCell.length > 0 && cell.classList.contains('cell')) {
                cell.classList.add('hide-icon');
            }
            // ▲▲▲ FIN INSERCIÓN 2 ▲▲▲
            // --- INICIO DE LA MODIFICACIÓN: Lógica condicional Ludo vs Parchís ---
            // ▼▼▼ MODIFICACIÓN 1: DETECTAR Y MARCAR BLOQUEO ▼▼▼
            let isBlockade = false;

            if (gameType === 'parchis' && boardRules) {
                const posNum = parseInt(position, 10);
                let isExcluded = false;

                // Verificación de exclusiones (Meta y Zona Segura de llegada)
                if (goalPositions.includes(posNum)) {
                    isExcluded = true;
                } else {
                    for (const [, stretchPositions] of homeStretchEntries) {
                        if (Array.isArray(stretchPositions) && stretchPositions.includes(posNum)) {
                            isExcluded = true;
                            break;
                        }
                    }
                }

                // Si es bloqueo válido
                if (!isExcluded && allPiecesInCell.length >= 2) {
                    cell.classList.add('blocked-cell');
                    isBlockade = true;
                }
            }
            // ▲▲▲ FIN MODIFICACIÓN 1 ▲▲▲

            const isSvgCell = !(cell.tagName.toLowerCase() === 'div' && cell.classList.contains('cell'));
            
            if (gameType === 'ludo') {
                // --- LÓGICA DE LUDO (Apilar por color con contador) ---
                
                // 1. Agrupar por color DENTRO de la celda
                const piecesByColorInCell = {};
                allPiecesInCell.forEach(piece => {
                    if (!piecesByColorInCell[piece.color]) {
                        piecesByColorInCell[piece.color] = [];
                    }
                    piecesByColorInCell[piece.color].push(piece);
                });

                const totalColorGroupsInCell = Object.keys(piecesByColorInCell).length;
                let groupIndexInCell = 0;
                const basePieceSize = (boardRect.width / 15 * 0.45); // Tamaño base de ficha

                // 2. Iterar sobre los GRUPOS DE COLOR
                for (const color in piecesByColorInCell) {
                    const piecesInGroup = piecesByColorInCell[color];
                    const pieceToDraw = piecesInGroup[0]; // Usamos la primera ficha para datos
                    const count = piecesInGroup.length; // Total de fichas de ESTE color

                    const pieceElement = document.createElement('div');
                    pieceElement.className = `ludo-piece active ${color}`;
                    // Usamos el ID de la *primera* ficha del grupo como ID visual
                    pieceElement.id = pieceToDraw.id; 

                    // Si hay múltiples GRUPOS DE COLOR, los hacemos pequeños
                    if (totalColorGroupsInCell > 1) {
                        pieceElement.classList.add('stacked');
                    }

                    // 3. Añadir el contador si hay más de una ficha DE ESTE COLOR
                    if (count > 1) {
                        const counter = document.createElement('div');
                        counter.className = 'piece-stack-counter';
                        counter.textContent = count;
                        // El CSS en ludo.css se encarga de centrarlo y rotarlo
                        pieceElement.appendChild(counter);
                    }

                    // 4. Lógica de Offset (para los GRUPOS DE COLOR)
                    let offsetX = 0;
                    let offsetY = 0;

                    if (totalColorGroupsInCell > 1) {
                        let orientation = 'horizontal'; 
                        if (!isSvgCell) { 
                            const parentPath = cell.closest('.path');
                            if (parentPath && parentPath.classList.contains('path-vertical')) {
                                orientation = 'vertical';
                            }
                        }
                        const offsetAmount = basePieceSize * 0.55; 
                        const outerMultiplier = 1.65; 

                        switch (totalColorGroupsInCell) {
                            case 2:
                                if (orientation === 'vertical') { 
                                    offsetX = (groupIndexInCell === 0) ? -offsetAmount : offsetAmount;
                                } else { 
                                    offsetY = (groupIndexInCell === 0) ? -offsetAmount : offsetAmount;
                                }
                                break;
                            case 3:
                                if (orientation === 'vertical') {
                                    if (groupIndexInCell === 0) offsetX = -offsetAmount * outerMultiplier;
                                    else if (groupIndexInCell === 1) offsetX = 0;
                                    else offsetX = offsetAmount * outerMultiplier;
                                } else {
                                    if (groupIndexInCell === 0) offsetY = -offsetAmount * outerMultiplier;
                                    else if (groupIndexInCell === 1) offsetY = 0;
                                    else offsetY = offsetAmount * outerMultiplier;
                                }
                                break;
                            case 4:
                            default:
                                if (groupIndexInCell === 0) { offsetX = -offsetAmount; offsetY = -offsetAmount; }
                                else if (groupIndexInCell === 1) { offsetX = offsetAmount;  offsetY = -offsetAmount; }
                                else if (groupIndexInCell === 2) { offsetX = -offsetAmount; offsetY = offsetAmount; }
                                else { offsetX = offsetAmount;  offsetY = offsetAmount; }
                                break;
                        }
                    }

                    // 5. Añadir la ficha (grupo) al tablero
                    if (!isSvgCell) {
                        if (totalColorGroupsInCell > 1) {
                            pieceElement.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
                        }
                        cell.appendChild(pieceElement);
                    } else {
                        const cellRect = cell.getBoundingClientRect();
                        pieceElement.style.position = 'absolute';
                        pieceElement.style.left = `${cellRect.left + (cellRect.width / 2) - boardRect.left + offsetX}px`;
                        pieceElement.style.top = `${cellRect.top + (cellRect.height / 2) - boardRect.top + offsetY}px`;
                        svgPiecesContainer.appendChild(pieceElement);
                    }
                    
                    groupIndexInCell++;
                } // Fin del bucle for (colors)

            } else {
                // --- LÓGICA DE PARCHÍS (v3 - Estilo Ludo, sin contadores, respeta estado del servidor) ---

                // (Se elimina la lógica 'slice(0, 2)'. El cliente dibujará lo que el servidor le indique)
                // (La lógica del servidor en 'calculatePath' ya previene que 3 fichas aterricen en casillas no seguras)

                const piecesToDraw = allPiecesInCell; // Dibujar todas las fichas que están en la celda

                const totalPiecesToDraw = piecesToDraw.length;
                let pieceIndexInCell = 0;
                const basePieceSize = (boardRect.width / 15 * 0.45); // Tamaño base de ficha

                // 2. Iterar sobre las FICHAS INDIVIDUALES
                for (const pieceToDraw of piecesToDraw) {

                    const pieceElement = document.createElement('div');
                    pieceElement.className = `ludo-piece active ${pieceToDraw.color}`;
                    pieceElement.id = pieceToDraw.id; 

                    // ▼▼▼ ¡AÑADE ESTE BLOQUE! ▼▼▼
                    // (La variable 'isBlockade' se define líneas arriba, 
                    // y es la misma que pone la casilla negra)
                    if (isBlockade) {
                        pieceElement.classList.add('in-blockade');
                    }
                    // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

                    // Si hay múltiples FICHAS, las hacemos pequeñas (Req 2)
                    if (totalPiecesToDraw > 1) {
                        pieceElement.classList.add('stacked');
                    }

                    // (No hay contadores)

                    // 4. Lógica de Offset (para FICHAS INDIVIDUALES)
                    let offsetX = 0;
                    let offsetY = 0;

                    if (totalPiecesToDraw > 1) {
                        // (Obtener orientación)
                        let orientation = 'horizontal'; 
                        if (!isSvgCell) { 
                            const parentPath = cell.closest('.path');
                            if (parentPath && parentPath.classList.contains('path-vertical')) {
                                orientation = 'vertical';
                            }
                        } else {
                            // (Obtener orientación de la celda SVG)
                            // Llama a la función 'getVisualOrientation' (que ahora está corregida)
                            orientation = getVisualOrientation(position, boardRotation);
                        }

                        const offsetAmount = basePieceSize * 0.55; 
                        const outerMultiplier = 1.65; 

                        // Aplicamos el switch basado en totalPiecesToDraw
                        // (La lógica del servidor NUNCA debería permitir 3 o 4 en una casilla normal,
                        // pero esta lógica los manejará visualmente si ocurre en la meta)
                        switch (totalPiecesToDraw) {
                            case 2:
                                if (orientation === 'vertical') { 
                                    offsetX = (pieceIndexInCell === 0) ? -offsetAmount : offsetAmount;
                                } else { 
                                    offsetY = (pieceIndexInCell === 0) ? -offsetAmount : offsetAmount;
                                }
                                break;
                            case 3: 
                                if (orientation === 'vertical') {
                                    if (pieceIndexInCell === 0) offsetX = -offsetAmount * outerMultiplier;
                                    else if (pieceIndexInCell === 1) offsetX = 0;
                                    else offsetX = offsetAmount * outerMultiplier;
                                } else {
                                    if (pieceIndexInCell === 0) offsetY = -offsetAmount * outerMultiplier;
                                    else if (pieceIndexInCell === 1) offsetY = 0;
                                    else offsetY = offsetAmount * outerMultiplier;
                                }
                                break;
                            case 4:
                            default:
                                if (pieceIndexInCell === 0) { offsetX = -offsetAmount; offsetY = -offsetAmount; }
                                else if (pieceIndexInCell === 1) { offsetX = offsetAmount;  offsetY = -offsetAmount; }
                                else if (pieceIndexInCell === 2) { offsetX = -offsetAmount; offsetY = offsetAmount; }
                                else { offsetX = offsetAmount;  offsetY = offsetAmount; }
                                break;
                        }
                    }

                    // 5. Añadir la ficha (individual) al tablero
                    if (!isSvgCell) {
                        if (totalPiecesToDraw > 1) {
                            pieceElement.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
                        }
                        cell.appendChild(pieceElement);
                    } else {
                        const cellRect = cell.getBoundingClientRect();
                        pieceElement.style.position = 'absolute';
                        pieceElement.style.left = `${cellRect.left + (cellRect.width / 2) - boardRect.left + offsetX}px`;
                        pieceElement.style.top = `${cellRect.top + (cellRect.height / 2) - boardRect.top + offsetY}px`;
                        svgPiecesContainer.appendChild(pieceElement);
                    }

                    pieceIndexInCell++;
                } // Fin del bucle for (piecesToDraw)
            }
            // --- FIN DE LA MODIFICACIÓN ---
        } // Fin del bucle for (positions)
    }

    /**
     * Resalta las piezas que el jugador actual puede mover.
     */
    function updateClickablePieces() {
        if (!gameState || !gameState.gameState || !gameState.gameState.turn) return;

        const myColor = gameState.settings.colorMap[gameState.mySeatIndex];
        const turnData = gameState.gameState.turn;
        
        // ▼▼▼ AÑADE ESTE LOG ▼▼▼
        console.log(`updateClickablePieces - Dados actuales según gameState: ${turnData.dice.join(', ')}`);
        // ▲▲▲ FIN LOG ▲▲▲

        // 1. Limpiar todos los 'clickable' y listeners antiguos Y el dataset
        document.querySelectorAll('.ludo-piece').forEach(el => { // Selecciona TODAS las fichas para limpiar dataset
            el.classList.remove('clickable');
            el.onclick = null; // Elimina el listener anterior
            el.dataset.possibleMoves = '[]'; // Limpiar datos viejos
        });

        // 2. Si no es mi turno de mover, no hacer nada
        if (gameState.gameState.turn.playerIndex !== gameState.mySeatIndex || turnData.canRoll) {
            return;
        }

        // 3. Iterar sobre los movimientos posibles que envió el servidor
        turnData.possibleMoves.forEach(move => {
            // ▼▼▼ BLOQUE COMENTADO (SALIDA AUTOMÁTICA CON DOBLES) ▼▼▼
            /*
            if (move.type === 'move_from_base') {
                // Hacer clicables TODAS mis fichas en base
                const basePieces = document.querySelectorAll(`.ludo-piece.in-base.${myColor}`);
                basePieces.forEach(pieceEl => {
                    pieceEl.classList.add('clickable');
                    pieceEl.onclick = () => {
                        // Al hacer clic, enviamos el ID de esta ficha específica
                        socket.emit('ludoMovePiece', {
                            roomId,
                            move: { type: 'move_from_base', pieceId: pieceEl.id }
                        });
                    };
                });
            }
            */
            // ▲▲▲ FIN DEL BLOQUE COMENTADO ▲▲▲

            // ▼▼▼ BLOQUE ACTUALIZADO PARA ELECCIÓN DE DADO ▼▼▼
            if (move.type === 'move_active_piece' || move.type === 'move_prize_piece') {
                const pieceEl = document.getElementById(move.pieceId);
                if (pieceEl) {
                    pieceEl.classList.add('clickable'); // Siempre la hacemos clicable

                    // ▼▼▼ AÑADE ESTA LIMPIEZA EXPLÍCITA ▼▼▼
                    // Si es la primera vez que añadimos un movimiento a esta ficha en este turno, limpiamos datos viejos.
                    if (!pieceEl.dataset.possibleMoves || pieceEl.dataset.possibleMoves === '[]') {
                        pieceEl.dataset.possibleMoves = '[]'; // Asegura que esté vacío antes de añadir
                    }
                    // ▲▲▲ FIN LIMPIEZA ▲▲▲

                    // Guardamos TODOS los movimientos posibles para esta ficha
                    let currentMoves = pieceEl.dataset.possibleMoves ? JSON.parse(pieceEl.dataset.possibleMoves) : [];
                    // Evita duplicados (por si acaso)
                    if (!currentMoves.some(m => m.dice === move.diceValue && m.target === move.targetPosition && m.type === move.type)) {
                        currentMoves.push({ 
                            dice: move.diceValue, 
                            target: move.targetPosition,
                            type: move.type || 'move_active_piece',
                            isKill: move.isKill || false // <-- ¡AÑADE ESTA LÍNEA!
                        });
                    }
                    pieceEl.dataset.possibleMoves = JSON.stringify(currentMoves);

                    // Asigna el handler de clic UNA SOLA VEZ
                    if (!pieceEl.onclick) {
                        pieceEl.onclick = handlePieceClick;
                    }
                }
            }
            // ▲▲▲ FIN DEL BLOQUE ACTUALIZADO ▲▲▲
        });
        console.log("Piezas clicables actualizadas."); // Log para depuración
    }

    /**
     * Maneja el clic en una ficha activa y muestra opciones si hay múltiples dados.
     */
    /**
     * Maneja el clic en una ficha activa, aplica lógica automática si es la única jugable,
     * o muestra opciones si hay múltiples dados/fichas.
     */
    /**
     * Maneja el clic en una ficha activa, aplica lógica automática si es la única jugable,
     * o muestra opciones si hay múltiples dados/fichas.
     */
    /**
     * Maneja el clic en una ficha activa, aplica lógica automática si es la única jugable,
     * o muestra opciones si hay múltiples dados/fichas.
     */
    function handlePieceClick(event) {
        // ▼▼▼ CORRECCIÓN: Verificar si el jugador está en espera ▼▼▼
        const mySeat = gameState?.seats?.find(s => s && s.playerId === socket.id);
        if (mySeat && mySeat.status === 'waiting') {
            console.warn("handlePieceClick: Jugador en espera, acción bloqueada");
            return;
        }
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
        
        const pieceEl = event.currentTarget;
        const pieceId = pieceEl.id;
        const potentialMovesDataString = pieceEl.dataset.possibleMoves || '[]';

        // Limpiar popups anteriores
        document.querySelectorAll('.dice-choice-popup').forEach(p => p.remove());

        if (!gameState || !gameState.gameState || !gameState.gameState.turn) {
            console.error("handlePieceClick: Estado de turno no disponible.");
            return;
        }
        const currentTurnData = gameState.gameState.turn;
        const availableDice = currentTurnData.moves || [];

        console.log(`--- handlePieceClick para ${pieceId} ---`);
        console.log("Datos crudos del dataset (potential):", potentialMovesDataString);
        console.log("Dados restantes AHORA (availableDice):", availableDice);

        let potentialMoves = [];
        try {
            potentialMoves = JSON.parse(potentialMovesDataString);
        } catch (e) {
            console.error("Error al parsear potentialMoves:", e);
            return;
        }

        if (potentialMoves.length === 0) {
             console.warn(`Clic en ${pieceId}, pero no hay movimientos potenciales.`);
             return;
        }

        const prizeMoves = potentialMoves.filter(move => (move.type || 'move_active_piece') === 'move_prize_piece');
        let finalValidOptions = [];

        if (prizeMoves.length > 0) {
            console.log("Detectados movimientos de premio. Ignorando dados normales.");
            finalValidOptions = prizeMoves;
        } else {
            if (availableDice.length === 0) {
                console.warn(`Clic en ${pieceId}, pero no hay dados disponibles para movimientos normales.`);
                return;
            }
            console.log("No hay movimientos de premio. Filtrando por dados normales.");
            finalValidOptions = potentialMoves.filter(move => {
                const moveType = move.type || 'move_active_piece';
                const isIndividualAvailable = (move.dice <= 6 && availableDice.includes(move.dice));
                const isSumAvailable = (
                    availableDice.length === 2 &&
                    availableDice[0] + availableDice[1] === move.dice
                );
                return (isIndividualAvailable || isSumAvailable) && moveType === 'move_active_piece';
            });
        }

        console.log("Opciones válidas AHORA (finalValidOptions):", finalValidOptions);

        if (finalValidOptions.length === 0) {
             console.warn(`Clic en ${pieceId}, pero ninguna opción coincide con los dados restantes: ${availableDice}`);
             return;
        }

        // --- INICIO: Comprobación especial para Salida Automática --- // Colocado antes del IF
        let isOnStartingSquareWithSiblings = false;
        if (gameState?.settings?.autoExit === 'auto') {
            const myColor = gameState.settings.colorMap[gameState.mySeatIndex];
            const startPosition = gameState.gameState?.board?.start[myColor];
            // Asegurarse de que pieceEl exista antes de buscar closest
            const parentCell = pieceEl ? pieceEl.closest('[data-cell]') : null;
            const piecePosition = parseInt(parentCell?.dataset.cell || '-1');

            if (startPosition !== undefined && piecePosition === startPosition) {
                let piecesOnStart = 0;
                const myPieces = gameState.gameState?.pieces[myColor] || [];
                myPieces.forEach(p => {
                    if (p.state === 'active' && p.position === startPosition) {
                        piecesOnStart++;
                    }
                });
                if (piecesOnStart > 1) {
                    isOnStartingSquareWithSiblings = true;
                    console.log(`🏁 Detectado clic en casilla de salida (${startPosition}) con ${piecesOnStart} fichas. Se forzará popup.`);
                }
            }
        }
        // --- FIN: Comprobación especial ---

        // --- INICIO: Comprobación si la ficha está apilada con fichas del MISMO color ---
        let isStackedWithSameColor = false;
        const myColor = gameState?.settings?.colorMap[gameState.mySeatIndex];
        const pieceData = gameState?.gameState?.pieces[myColor]?.find(p => p.id === pieceId);

        if (myColor && pieceData && pieceData.state === 'active') {
            const currentPosition = pieceData.position;
            let countOnSquare = 0;
            const myPieces = gameState.gameState.pieces[myColor] || [];
            myPieces.forEach(p => {
                if (p.state === 'active' && p.position === currentPosition) {
                    countOnSquare++;
                }
            });
            if (countOnSquare > 1) {
                isStackedWithSameColor = true;
                console.log(`겹침 감지됨(${pieceId}) está apilada con ${countOnSquare - 1} ficha(s) más del mismo color en la casilla ${currentPosition}. Se forzará popup.`);
            }
        }
        // --- FIN: Comprobación de apilamiento ---

        // --- INICIO DE LA LÓGICA AUTOMÁTICA ---
        const clickablePieces = document.querySelectorAll('.ludo-piece.active.clickable');
        const isOnlyOneClickablePiece = clickablePieces.length === 1 && clickablePieces[0].id === pieceId;

        if (isOnlyOneClickablePiece && !isOnStartingSquareWithSiblings && !isStackedWithSameColor) {
            console.log(`🎯 Solo una ficha (${pieceId}) es jugable, no está apilada en salida ni con su color. Aplicando movimiento automático...`);

            const prizeOption = finalValidOptions.find(option => (option.type || 'move_active_piece') === 'move_prize_piece');
            if (prizeOption) {
                console.log(`🎯 Auto: Ejecutando PREMIO ${prizeOption.dice}`);
                sendMoveToServer(pieceId, prizeOption.dice, prizeOption.type);
                return;
            }

            const gameType = gameState?.settings?.gameType || 'ludo';
            console.log(`[Auto-Move] gameType detectado: ${gameType}`);

            if (gameType === 'ludo') {
                // --- LÓGICA DE LUDO (SUM > MAJOR > MINOR) ---
                console.log(`[Auto-Move] Aplicando lógica LUDO...`);

                const sumOption = availableDice.length === 2 ? finalValidOptions.find(option =>
                    option.dice === availableDice[0] + availableDice[1] && (option.type || 'move_active_piece') === 'move_active_piece'
                ) : null;

                if (sumOption) {
                    console.log(`🎯 Auto: Ejecutando SUMA ${sumOption.dice}`);
                    sendMoveToServer(pieceId, sumOption.dice, sumOption.type);
                    return;
                }

                if (availableDice.length > 0) {
                    const maxDie = Math.max(...availableDice);
                    const maxDieOption = finalValidOptions.find(option => option.dice === maxDie && (option.type || 'move_active_piece') === 'move_active_piece');
                    if (maxDieOption) {
                        console.log(`🎯 Auto: Ejecutando DADO MAYOR ${maxDieOption.dice}`);
                        sendMoveToServer(pieceId, maxDieOption.dice, maxDieOption.type);
                        return;
                    }
                }

                if (finalValidOptions.length > 0) {
                    const minDieOption = finalValidOptions.reduce((min, current) =>
                        (current.dice < min.dice ? current : min), finalValidOptions[0]);
                    console.log(`🎯 Auto: Ejecutando DADO MENOR ${minDieOption.dice}`);
                    sendMoveToServer(pieceId, minDieOption.dice, minDieOption.type);
                    return;
                }

            } else if (gameType === 'parchis') {
                // --- LÓGICA DE PARCHÍS (SUM > CHOICE, pero priorizando Kill) ---
                console.log(`[Auto-Move] Aplicando lógica PARCHÍS...`);

                // 1. Buscar opción de SUMA
                const sumOption = availableDice.length === 2 ? finalValidOptions.find(option =>
                    option.dice === availableDice[0] + availableDice[1] && (option.type || 'move_active_piece') === 'move_active_piece'
                ) : null;
                
                // 2. Buscar opciones INDIVIDUALES
                const individualOptions = finalValidOptions.filter(opt => opt.dice <= 6);

                // ▼▼▼ CORRECCIÓN: DETECTAR MATANZA (Leyendo el flag 'isKill') ▼▼▼
                
                // Leemos la propiedad 'isKill' que guardamos en el Paso 2.
                const killOptions = individualOptions.filter(opt => opt.isKill === true);
                const canKillWithIndividualDie = killOptions.length > 0;
                
                if (canKillWithIndividualDie) {
                     console.log(`[Parchís] ¡Opción de Matar detectada (desde el servidor) con dado(s) ${killOptions.map(k => k.dice).join(', ')}! Forzando Popup.`);
                }
                
                // ▲▲▲ FIN CORRECCIÓN ▲▲▲

                // Lógica de decisión:
                // Si hay Suma Y NO hay oportunidad de matar individualmente -> Jugar Suma Automática
                if (sumOption && !canKillWithIndividualDie) {
                    console.log(`🎯 Auto (Parchís): Ejecutando SUMA ${sumOption.dice} (Sin matanza individual)`);
                    sendMoveToServer(pieceId, sumOption.dice, sumOption.type);
                    return;
                }

                // Si hay Suma PERO puedo matar con un dado -> MOSTRAR POPUP (Para elegir Matar o Suma)
                // O si no hay suma -> MOSTRAR POPUP (o auto si es único)
                
                if (individualOptions.length === 1 && !sumOption) {
                    // Caso borde: Solo 1 dado individual posible y nada más
                    console.log(`🎯 Auto (Parchís): Ejecutando único dado individual ${individualOptions[0].dice}`);
                    sendMoveToServer(pieceId, individualOptions[0].dice, individualOptions[0].type);
                } else {
                    // Caso: Hay opciones (Suma vs Matar, o Dado 1 vs Dado 2)
                    console.log(`[Auto-Move] (Parchís) Mostrando opciones (Suma disponible: ${!!sumOption}, Kill posible: ${canKillWithIndividualDie}).`);
                    
                    // Combinamos las opciones para el popup (Suma + Individuales)
                    // finalValidOptions ya las contiene todas
                    createDiceChoicePopup(pieceEl, finalValidOptions);
                }
                return; // Importante salir de la función
            }

            console.warn("Error en lógica automática: No se encontró movimiento válido.");

        } else {
            // --- LÓGICA PARA MÚLTIPLES FICHAS / MÚLTIPLES OPCIONES / APILADAS ---
            console.log(`Múltiples fichas (${clickablePieces.length}), múltiples dados, apilada en salida O apilada con su color. Mostrando opciones/ejecutando único.`);

            if (finalValidOptions.length === 1) {
                const chosenMove = finalValidOptions[0];
                console.log(`🖱️ Ficha ${pieceId} clicada. Enviando único movimiento válido: ${chosenMove.dice}`);
                sendMoveToServer(pieceId, chosenMove.dice, chosenMove.type);
            } else {
                console.log("Creando popup para elegir dado...");
                createDiceChoicePopup(pieceEl, finalValidOptions);
            }
        }
        // --- FIN DE LA LÓGICA AUTOMÁTICA ---
    }
    /**
     * Envía el movimiento elegido al servidor.
     * @param {string} pieceId - ID de la ficha movida.
     * @param {number} diceValue - Valor del dado (o suma) usado.
     */
    function sendMoveToServer(pieceId, diceValue, moveType = 'move_active_piece') {
        // Limpiar popups por si acaso
        document.querySelectorAll('.dice-choice-popup').forEach(p => p.remove());
        // Limpiar dataset de la ficha movida
        const pieceEl = document.getElementById(pieceId);
        if (pieceEl) pieceEl.dataset.possibleMoves = '[]';

        console.log(`-> Enviando ludoMovePiece al servidor: ${pieceId} con ${diceValue} (Tipo: ${moveType})`);
        socket.emit('ludoMovePiece', {
            roomId,
            move: { type: moveType, pieceId: pieceId, diceValue: diceValue }
        });
    }

    /**
     * Crea y muestra el popup para elegir un dado.
     * @param {HTMLElement} pieceElement - El elemento de la ficha clicada.
     * @param {Array} validOptions - Las opciones de movimiento válidas [{dice: number, target: number}, ...].
     */
    function createDiceChoicePopup(pieceElement, validOptions) {
        const popup = document.createElement('div');
        popup.className = 'dice-choice-popup';

        validOptions.forEach(moveOption => {
            const btn = document.createElement('button');
            btn.textContent = `Mover ${moveOption.dice}`;
            btn.onclick = (e) => {
                e.stopPropagation();
                console.log(`Botón '${moveOption.dice}' presionado para ${pieceElement.id}.`);
                sendMoveToServer(pieceElement.id, moveOption.dice, moveOption.type || 'move_active_piece'); // Llama a la función auxiliar
            };
            popup.appendChild(btn);
        });

        // Botón Cancelar
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'X';
        cancelBtn.style.marginLeft = '5px';
        cancelBtn.style.background = '#e74c3c';
        cancelBtn.onclick = (e) => { e.stopPropagation(); popup.remove(); };
        popup.appendChild(cancelBtn);

        // ----------------------------------------------------
        // --- INICIO DEL CÓDIGO DE POSICIONAMIENTO CORREGIDO ---
        // ----------------------------------------------------
        
        const parentCell = pieceElement.closest('.path .cell, .svg-cell');
        const boardContainer = document.getElementById('ludo-board-container') || document.body;
        const boardRect = boardContainer.getBoundingClientRect(); // Rectángulo del tablero (referencia)
        const pieceRect = pieceElement.getBoundingClientRect(); // Rectángulo de la pieza (posición)
        
        // 1. Posición base (en el centro de la pieza)
        let popupLeft = (pieceRect.left + pieceRect.width / 2) - boardRect.left;
        let popupTop = (pieceRect.top - boardRect.top) + pieceRect.height + 30; // 30px por debajo de la pieza para no taparla

        // 2. Crear y añadir el popup al DOM para medir su tamaño real
        boardContainer.appendChild(popup);
        popup.style.position = 'absolute';
        popup.style.top = `${popupTop}px`;
        popup.style.zIndex = '100';
        popup.style.whiteSpace = 'nowrap';

        const popupRect = popup.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        // 3. Aplicar corrección de límites (Ajuste Horizontal)
        
        // Si el borde izquierdo del popup se sale (es menor que 0)
        if (pieceRect.left - (popupRect.width / 2) < 5) { // 5px de margen
            // Fija el popup a 5px del borde izquierdo de la pantalla, relativo al tablero.
            popupLeft = 5 - boardRect.left; 
            popup.style.transform = 'none'; // Desactiva el -50%
            
        // Si el borde derecho del popup se sale (es mayor que el ancho de la ventana)
        } else if (pieceRect.right + (popupRect.width / 2) > viewportWidth - 5) { // 5px de margen
            // Fija el popup al borde derecho de la pantalla, relativo al tablero.
            popupLeft = (viewportWidth - 5) - boardRect.left - popupRect.width; 
            popup.style.transform = 'none'; // Desactiva el -50%
            
        } else {
            // Centrado normal (solo necesita el -50% de transform)
            popup.style.transform = 'translateX(-50%)';
        }
        
        // 4. Aplicar la posición final calculada al elemento
        popup.style.left = `${popupLeft}px`;

        console.log("Popup añadido a boardContainer. Posición ajustada para límites.");
        
        // ----------------------------------------------------
        // --- FIN DEL CÓDIGO DE POSICIONAMIENTO CORREGIDO ---
        // ----------------------------------------------------
    }

    /**
     * Anima el movimiento de una ficha paso a paso (VERSIÓN ROBUSTA FINAL).
     * @param {string} pieceId - ID del elemento de la ficha.
     * @param {Array<number>} pathCells - Array con los números de las celdas del camino.
     * @param {number} durationPerStep - Duración en ms para cada salto.
     */
    async function animatePieceStep(pieceId, pathCells, durationPerStep = 150) {
        const pieceElement = document.getElementById(pieceId);
        
        // 1. OBTENER LA CAPA DE ANIMACIÓN (#board-cells)
        const svgPiecesContainer = document.getElementById('board-cells');
        
        if (!pieceElement || pathCells.length === 0 || !svgPiecesContainer) {
            console.warn(`🎬 Animación cancelada para ${pieceId} (Ficha o capa no encontrada)`);
            return;
        }

        console.log(`🎬 Animando ${pieceId} por ruta: ${pathCells.join(' -> ')}`);

        // --- INICIO DE LA CORRECCIÓN (Posicionamiento inicial) ---
        
        // 2. OBTENER EL RECTÁNGULO DEL CONTENEDOR DEL TABLERO (NUESTRO 'PUNTO 0,0')
        // Usamos #ludo-board-container porque #board-cells está posicionado relativo a él
        const boardContainer = document.getElementById('ludo-board-container');
        if (!boardContainer) {
            console.error('No se encontró #ludo-board-container');
            return;
        }
        const containerRect = boardContainer.getBoundingClientRect();

        // 3. ¡IMPORTANTE! OBTENER LA CELDA DONDE ESTÁ LA FICHA ACTUALMENTE
        // Buscamos la celda padre de la ficha (puede ser .cell o .svg-cell)
        const currentCell = pieceElement.closest('[data-cell]');
        
        let initialLeft = 0;
        let initialTop = 0;
        
        if (currentCell) {
            // Si encontramos la celda actual, calculamos la posición desde ella
            const cellRect = currentCell.getBoundingClientRect();
            
            initialLeft = (cellRect.left + cellRect.width / 2) - containerRect.left;
            initialTop = (cellRect.top + cellRect.height / 2) - containerRect.top;
            
            console.log(`🎯 Ficha ${pieceId} está en celda ${currentCell.getAttribute('data-cell')}. Pos inicial: (${initialLeft.toFixed(2)}, ${initialTop.toFixed(2)})`);
        } else {
            // Fallback: usar la posición actual de la ficha
            const startRect = pieceElement.getBoundingClientRect();
            initialLeft = (startRect.left + startRect.width / 2) - containerRect.left;
            initialTop = (startRect.top + startRect.height / 2) - containerRect.top;
            
            console.warn(`⚠️ No se encontró celda padre para ${pieceId}. Usando posición de la ficha.`);
        }
        
        // --- FIN DE LA CORRECCIÓN (Posicionamiento inicial) ---


        // ▼▼▼ INICIO DE LA SOLUCIÓN "SPLIT STACK" ▼▼▼

        const counter = pieceElement.querySelector('.piece-stack-counter');
        let pieceToAnimate; // Esta es la ficha que se moverá visualmente

        if (counter) {
            // ¡ES UN STACK! Vamos a "dividirlo".
            console.log(`[Animate] Split: ${pieceId} es un stack. Clonando para animar.`);

            // 1. Clonar la ficha para la animación
            pieceToAnimate = pieceElement.cloneNode(true);
            
            // 2. Quitar el contador y la clase 'stacked' del CLON
            const clonedCounter = pieceToAnimate.querySelector('.piece-stack-counter');
            if (clonedCounter) {
                clonedCounter.remove();
            }
            pieceToAnimate.classList.remove('stacked'); // La pieza individual no es 'stacked'
            
            // 3. Actualizar el contador de la ficha ORIGINAL (la que se queda)
            const newCount = parseInt(counter.textContent) - 1;
            if (newCount > 1) {
                counter.textContent = newCount;
            } else {
                // Si solo queda 1, eliminamos el contador
                counter.remove();
            }

        } else {
            // NO ES UN STACK. Animamos la ficha original.
            pieceToAnimate = pieceElement;
        }
        
        // ▼▼▼ FIN DE LA SOLUCIÓN "SPLIT STACK" ▼▼▼


        // 4. AHORA SÍ, MOVER LA 'pieceToAnimate' A LA CAPA DE ANIMACIÓN
        svgPiecesContainer.appendChild(pieceToAnimate); 
        
        // 5. APLICAR ESTILOS Y ¡LA POSICIÓN INICIAL!
        pieceToAnimate.style.position = 'absolute';
        pieceToAnimate.style.zIndex = '50';
        pieceToAnimate.style.left = `${initialLeft}px`; // <-- FIJA LA POSICIÓN INICIAL
        pieceToAnimate.style.top = `${initialTop}px`;   // <-- FIJA LA POSICIÓN INICIAL

        // Forzar al navegador a aplicar la posición inicial ANTES del primer salto
        await new Promise(resolve => setTimeout(resolve, 10)); // Pequeña espera (10ms)

        // 7. BUCLE DE ANIMACIÓN (PASO A PASO) - Usando pieceToAnimate
        for (let i = 0; i < pathCells.length; i++) {
            const cellNumber = pathCells[i];
            
            // BUSCAR LA CELDA DE DESTINO (sea div o svg)
            const cellElement = document.querySelector(`[data-cell="${cellNumber}"]`);
            
            if (!cellElement) {
                console.warn(`Animación: No se encontró [data-cell="${cellNumber}"]`);
                continue;
            }

            // OBTENER RECTÁNGULO DE LA CELDA DE DESTINO
            const cellRect = cellElement.getBoundingClientRect();

            // CALCULAR EL CENTRO DE LA CELDA (relativo al containerRect)
            const targetLeft = (cellRect.left + cellRect.width / 2) - containerRect.left;
            const targetTop = (cellRect.top + cellRect.height / 2) - containerRect.top;

            // Mover la ficha usando left y top (método original que funcionaba bien)
            pieceToAnimate.style.left = `${targetLeft}px`;
            pieceToAnimate.style.top = `${targetTop}px`;
            
            // Reproducir sonido al saltar a cada casilla
            playSound('tag');

            // ESPERAR para el efecto de salto
            await new Promise(resolve => setTimeout(resolve, durationPerStep));
        }

        // 8. LIMPIAR LA FICHA ANIMADA
        // La eliminamos para que 'renderActivePieces' la redibuje correctamente
        pieceToAnimate.remove();

        console.log(`✅ Animación terminada y ${pieceId} (o su clon) eliminado (listo para redibujar).`);
    }

    /**
     * Actualiza la UI de los dados y brillos de turno.
     */
    function updateTurnUI() {
        if (!gameState || !gameState.gameState || !gameState.gameState.turn) {
            console.warn("updateTurnUI: gameState o turn no disponibles."); // Log de advertencia
            return;
        }

        // ▼▼▼ CORRECCIÓN: Verificar si el jugador está en espera ▼▼▼
        const mySeat = gameState.seats.find(s => s && s.playerId === socket.id);
        const isWaitingPlayer = mySeat && mySeat.status === 'waiting';
        
        if (isWaitingPlayer) {
            // Si el jugador está en espera, deshabilitar todas las interacciones
            if (myDiceContainer) {
                myDiceContainer.style.pointerEvents = 'none';
                console.log("❌ Jugador en espera: Dados deshabilitados");
            }
            return; // No hacer más actualizaciones
        }
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

        const turn = gameState.gameState.turn;
        const myTurn = (turn.playerIndex === gameState.mySeatIndex);

        // ▼▼▼ AÑADE ESTOS LOGS ▼▼▼
        console.log(`--- updateTurnUI ---`);
        console.log(`Es mi turno (myTurn): ${myTurn} (Índice Turno: ${turn.playerIndex}, Mi Índice: ${gameState.mySeatIndex})`);
        console.log(`Puedo tirar (turn.canRoll): ${turn.canRoll}`);
        // ▲▲▲ FIN LOGS ▲▲▲

        // Actualizar dados
        if (myDiceContainer) {
            if (myTurn && turn.canRoll) {
                console.log("✅ Habilitando dados (pointerEvents = 'auto')"); // Log de éxito
                myDiceContainer.style.pointerEvents = 'auto'; // Habilitar mis dados
            } else {
                console.log("❌ Deshabilitando dados (pointerEvents = 'none')"); // Log de fallo
                myDiceContainer.style.pointerEvents = 'none'; // Deshabilitar mis dados
            }
        } else {
            console.warn("updateTurnUI: myDiceContainer no encontrado."); // Log de advertencia
        }

        // TODO: Actualizar brillo de turno (se hace en updateTurnGlow)
    }

    /**
     * Actualiza el brillo visual para indicar de quién es el turno.
     * @param {number} currentPlayerIndex - El índice del asiento (0-3) del jugador actual.
     */
    function updateTurnGlow(currentPlayerIndex) {
        document.querySelectorAll('.player-dice-container').forEach(container => {
            container.style.visibility = 'hidden';
        });

        // Si el juego no ha empezado o no hay índice, quitar todos los brillos
        if (!gameState || currentPlayerIndex < 0 || currentPlayerIndex >= gameState.seats.length) { 
            document.querySelectorAll('.player-info-box.current-turn-glow').forEach(el => {
                el.classList.remove('current-turn-glow');
            });
            return;
        }

        const mySeatIndex = gameState.mySeatIndex;
        // Si soy espectador (mySeatIndex es -1), no aplico brillo relativo
        if (mySeatIndex === -1) {
            // Podríamos intentar mostrar el brillo en el color real, pero es más complejo
            // Por ahora, los espectadores no ven el brillo.
             document.querySelectorAll('.player-info-box.current-turn-glow').forEach(el => {
                el.classList.remove('current-turn-glow');
            });
            return;
        }

        const totalSeats = gameState.seats.length; // Usualmente 4

        // ▼▼▼ LÓGICA CORREGIDA ▼▼▼
        // 1. Calcular la diferencia de asientos (en sentido horario) desde MI asiento
        //    hasta el asiento del jugador actual.
        //    Ej: Si yo soy Asiento 3 (Azul) y el turno es del Asiento 1 (Verde):
        //        (1 - 3 + 4) % 4 = 2. La diferencia es 2.
        const seatDifference = (currentPlayerIndex - mySeatIndex + totalSeats) % totalSeats;

        // 2. Mapear esta diferencia al índice del slot físico:
        //    Diferencia 0 -> Mi slot ('yellow', índice 0)
        //    Diferencia 1 -> Slot a mi izquierda ('green', índice 1)
        //    Diferencia 2 -> Slot opuesto ('red', índice 2)
        //    Diferencia 3 -> Slot a mi derecha ('blue', índice 3)
        const physicalSlotIndex = seatDifference;

        // 3. Obtener el nombre del color del slot físico usando el array PHYSICAL_SLOTS
        const physicalSlotColor = PHYSICAL_SLOTS[physicalSlotIndex];
        // ▲▲▲ FIN DE LA LÓGICA CORREGIDA ▲▲▲

        // 4. Quitar el brillo de todas las cajas primero
        document.querySelectorAll('.player-info-box.current-turn-glow').forEach(el => {
            el.classList.remove('current-turn-glow');
        });

        // 5. Añadir el brillo SÓLO a la caja física correcta
        const targetInfoBox = document.getElementById(`player-info-box-${physicalSlotColor}`);
        if (targetInfoBox) {
            targetInfoBox.classList.add('current-turn-glow');
            console.log(`✨ Brillo de turno añadido a: ${physicalSlotColor} (Índice original: ${currentPlayerIndex}, Mi índice: ${mySeatIndex}, Diferencia: ${seatDifference})`);
        } else {
            console.warn(`No se encontró la caja de info para añadir brillo: player-info-box-${physicalSlotColor}`);
        }

        const targetDiceContainer = document.getElementById(`player-dice-container-${physicalSlotColor}`);
        if (targetDiceContainer) {
            targetDiceContainer.style.visibility = 'visible';
        }
    }
    // ▲▲▲ FIN DE LAS NUEVAS FUNCIONES ▲▲▲
    
    // 1. Unirse a la sala
    // ▼▼▼ BLOQUE MODIFICADO - Usar localStorage como respaldo para PWA ▼▼▼
    let userId = sessionStorage.getItem('userId') || localStorage.getItem('userId');
    
    // Si no hay userId, intentar recuperarlo desde username (sessionStorage o localStorage)
    if (!userId) {
        const username = sessionStorage.getItem('username') || localStorage.getItem('username');
        if (username) {
            userId = 'user_' + username.toLowerCase();
            // Guardar en ambos para persistencia en PWA
            sessionStorage.setItem('userId', userId);
            localStorage.setItem('userId', userId);
            console.log('[joinLudoGame] userId restaurado desde username:', userId);
        }
    } else {
        // Si encontramos userId, asegurarnos de que esté en ambos lugares
        sessionStorage.setItem('userId', userId);
        localStorage.setItem('userId', userId);
    }
    
    if (!userId) {
        alert('Error: No se encontró el ID de usuario. Volviendo al lobby.');
        window.location.href = '/ludo';
        return;
    }
    
    console.log('[joinLudoGame] Usando userId:', userId, 'para reconectar a roomId:', roomId);
    
    // Enviar el userId para la re-asociación
    socket.emit('joinLudoGame', { roomId, userId }); 
    // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲
    
    // 3. Listeners del Servidor para el juego
    socket.on('ludoGameState', (state) => {
        console.log('Estado inicial del juego recibido:', state);
        gameState = state;
        myPlayerId = socket.id; // Asumimos que el ID del socket es el ID del jugador

        // ▼▼▼ BLOQUE MODIFICADO PARA ESPERAR AL TABLERO ▼▼▼
        /**
         * Intenta renderizar el tablero. Si el script de ludo.html
         * aún no ha terminado de generar las celdas, espera 100ms y reintenta.
         */
        function attemptRender() {
            if (window.ludoBoardGenerated) {
                // ▼▼▼ INICIO MODIFICACIÓN ▼▼▼

                // 1. Renderizar el tablero y aplicar rotación CSS INMEDIATAMENTE
                console.log("   - Renderizando tablero y aplicando rotación...");
                renderLudoBoard(state); // Esto aplica el CSS transform rotate()

                // 2. ESPERAR un instante muy corto (e.g., 20ms)
                setTimeout(() => {
                    console.log("   - (Post-delay) Renderizando piezas...");
                    // 3. Renderizar piezas DESPUÉS del delay
                    renderBasePieces(state.gameState.pieces);
                    renderActivePieces(state.gameState.pieces);

                    // 4. Actualizar el resto de la UI (turno, bote, etc.)
                    updateTurnUI();
                    updateTurnGlow(state.gameState.turn.playerIndex);

                    // ▼▼▼ AÑADE ESTE BLOQUE ▼▼▼
                    // Actualizar UI del juego (Bote, Botón de inicio)
                    if (gamePotDisplay && state.gameState) {
                        gamePotDisplay.textContent = `${state.gameState.pot} ${state.settings.betCurrency || 'USD'}`;
                    }

                    // Mostrar botón de inicio SÓLO si soy el anfitrión Y el juego está en espera
                    if (btnStartGame && state.mySeatIndex === state.settings.hostSeatIndex && state.state === 'waiting') {
                        btnStartGame.style.display = 'block';
                        // --- INICIO LÓGICA DE HABILITACIÓN DE BOTÓN (REFORZADA) ---
                        const seatedPlayers = gameState.seats.filter(s => s !== null).length;
                        const gameType = gameState.settings.gameType;
                        const parchisMode = gameState.settings.parchisMode;

                        let canStart = false;
                        let btnText = 'Esperando jugadores...';

                        if (gameType === 'parchis' && parchisMode === '4-groups') {
                            canStart = (seatedPlayers === 4);
                            if (!canStart) {
                                btnText = `Esperando ${4 - seatedPlayers} jugador(es)...`;
                            }
                        } else if (gameType === 'parchis' && parchisMode === '2-individual') {
                            canStart = (seatedPlayers === 2);
                             if (!canStart && seatedPlayers < 2) {
                                btnText = `Esperando oponente...`;
                            }
                        } else { // Ludo o Parchis 4-individual
                            canStart = (seatedPlayers >= 2);
                        }

                        if (canStart) {
                            btnStartGame.disabled = false;
                            btnStartGame.textContent = 'Iniciar Juego';
                        } else {
                            btnStartGame.disabled = true;
                            btnStartGame.textContent = btnText;
                        }
                        // --- FIN LÓGICA DE HABILITACIÓN ---
                    }
                    // ▲▲▲ FIN DEL BLOQUE ▲▲▲
                    console.log('✅ Renderizado completo post-delay.');

                    // ▼▼▼ ¡AÑADE ESTA LÓGICA AQUÍ! ▼▼▼
                    // Si el estado es 'post-game', significa que nos unimos
                    // a una revancha. Debemos mostrar la pantalla de confirmación.
                    if (state.state === 'post-game') {
                        console.log('Detectado estado post-game. Mostrando pantalla de revancha...');
                        setupRematchScreen(); // Esta función muestra el overlay
                        
                        // Además, actualizamos la pantalla de revancha
                        // con los datos actuales que acabamos de recibir.
                        if (state.rematchData) {
                            // Llamamos directamente a la nueva función de UI
                            updateRematchUI(state.rematchData);
                        }
                    }
                    // ▲▲▲ FIN DE LA LÓGICA A AÑADIR ▲▲▲

                }, 20); // Delay corto de 20ms

                // ▲▲▲ FIN MODIFICACIÓN ▲▲▲
            } else {
                // El tablero aún no está listo, esperamos.
                console.warn('El tablero aún no se ha generado, esperando 100ms...');
                setTimeout(attemptRender, 100);
            }
        }
        
        // Inicia el primer intento de renderizado
        attemptRender();
        // ▲▲▲ FIN DEL BLOQUE MODIFICADO ▲▲▲
    });
    
    // ▼▼▼ NUEVO EVENTO: Cuando YO me uno a una sala ▼▼▼
    socket.on('joinedRoomSuccessfully', (data) => {
        console.log('Me he unido exitosamente a la sala:', data);
        
        // CORRECCIÓN: Asegurar que mySeatIndex sea válido
        if (data.mySeatIndex === -1 || data.mySeatIndex === null) {
            console.warn('mySeatIndex inválido recibido, buscando asiento disponible...');
            // Buscar el primer asiento disponible
            for (let i = 0; i < data.seats.length; i++) {
                if (data.seats[i] && data.seats[i].userId === data.userId) {
                    data.mySeatIndex = i;
                    break;
                }
            }
        }
        
        console.log('✅ mySeatIndex recibido:', data.mySeatIndex, 'Color asignado:', data.settings.colorMap[data.mySeatIndex]);
        
        // Construir el gameState completo
        gameState = {
            roomId: data.roomId,
            roomName: data.roomName,
            seats: data.seats,
            settings: data.settings,
            mySeatIndex: data.mySeatIndex,
            state: data.gameState ? 'playing' : 'waiting',
            gameState: data.gameState || { pot: 0, turn: {}, pieces: {}, board: {} }
        };
        
        myPlayerId = socket.id;
        
        // Renderizar el tablero con la rotación correcta
        function attemptRender() {
            if (window.ludoBoardGenerated) {
                // CORRECCIÓN: Renderizar el tablero completo con la rotación correcta
                renderLudoBoard(gameState);
                
                // CORRECCIÓN: Sincronizar completamente con el estado del juego
                if (gameState.gameState && gameState.gameState.pieces) {
                    renderBasePieces(gameState.gameState.pieces);
                    renderActivePieces(gameState.gameState.pieces);
                }
                
                if (gameState.gameState && gameState.gameState.turn) {
                    updateTurnUI();
                    updateTurnGlow(gameState.gameState.turn.playerIndex);
                }
                
                // Actualizar UI del juego
                if (gamePotDisplay && gameState.gameState) {
                    gamePotDisplay.textContent = `${gameState.gameState.pot} ${gameState.settings.betCurrency || 'USD'}`;
                }
                
                // Mostrar botón de inicio si soy el anfitrión
                if (btnStartGame && gameState.mySeatIndex === gameState.settings.hostSeatIndex && gameState.state === 'waiting') {
                    btnStartGame.style.display = 'block';
                    // --- INICIO LÓGICA DE HABILITACIÓN DE BOTÓN (REFORZADA) ---
                    const seatedPlayers = gameState.seats.filter(s => s !== null).length;
                    const gameType = gameState.settings.gameType;
                    const parchisMode = gameState.settings.parchisMode;

                    let canStart = false;
                    let btnText = 'Esperando jugadores...';

                    if (gameType === 'parchis' && parchisMode === '4-groups') {
                        canStart = (seatedPlayers === 4);
                        if (!canStart) {
                            btnText = `Esperando ${4 - seatedPlayers} jugador(es)...`;
                        }
                    } else if (gameType === 'parchis' && parchisMode === '2-individual') {
                        canStart = (seatedPlayers === 2);
                         if (!canStart && seatedPlayers < 2) {
                            btnText = `Esperando oponente...`;
                        }
                    } else { // Ludo o Parchis 4-individual
                        canStart = (seatedPlayers >= 2);
                    }

                    if (canStart) {
                        btnStartGame.disabled = false;
                        btnStartGame.textContent = 'Iniciar Juego';
                    } else {
                        btnStartGame.disabled = true;
                        btnStartGame.textContent = btnText;
                    }
                    // --- FIN LÓGICA DE HABILITACIÓN ---
                }
                
                // CORRECCIÓN: Actualizar las cajas de información de jugadores
                updatePlayerInfoBoxes(gameState.seats);
                
                console.log('✅ Tablero sincronizado correctamente para el jugador que se unió');
            } else {
                console.warn('El tablero aún no se ha generado, esperando 100ms...');
                setTimeout(attemptRender, 100);
            }
        }
        
        attemptRender();
    });
    // ▲▲▲ FIN NUEVO EVENTO ▲▲▲
    
    // ▼▼▼ AÑADE ESTE NUEVO LISTENER ▼▼▼
    // ▼▼▼ REEMPLAZA TU LISTENER 'playerJoined' CON ESTE BLOQUE COMPLETO ▼▼▼
    socket.on('playerJoined', (room) => {
        // 'room' AHORA CONTIENE .gameState gracias al cambio en el servidor
        if (!room || !room.seats || !room.gameState) { // <-- VALIDACIÓN ACTUALIZADA
            console.warn('Se recibió un evento playerJoined inválido (faltan seats o gameState).');
            return;
        }
        
        console.log('Un jugador se ha unido. Sincronizando estado completo:', room);
        
        // Si no tengo gameState aún, no hago nada (esperaré a ludoGameState)
        if (!gameState) {
            console.warn('No tengo gameState aún, esperando inicialización...');
            return;
        }
        
        // ▼▼▼ CORRECCIÓN: Verificar si soy un jugador en espera ▼▼▼
        const mySeat = room.seats.find(s => s && s.playerId === socket.id);
        const isWaitingPlayer = mySeat && mySeat.status === 'waiting';
        
        // 1. Actualiza el estado de los asientos
        gameState.seats = room.seats;
        
        // 2. Solo actualizar el estado del juego si NO soy un jugador en espera
        // o si el juego está en estado 'waiting' o 'post-game'
        if (!isWaitingPlayer || room.state === 'waiting' || room.state === 'post-game') {
            // Actualizar piezas solo si no soy jugador en espera durante partida activa
            if (room.gameState && room.gameState.pieces) {
                gameState.gameState.pieces = room.gameState.pieces;
            }
            
            // Actualizar turno solo si no soy jugador en espera durante partida activa
            if (room.gameState && room.gameState.turn && !isWaitingPlayer) {
                gameState.gameState.turn = room.gameState.turn;
            }
        } else {
            // Si soy jugador en espera durante partida activa, NO actualizar el turno
            console.log('Jugador en espera: No actualizando estado del turno para evitar bloqueo');
        }
        
        // 3. Vuelve a renderizar el tablero (info boxes y rotación)
        renderLudoBoard(gameState);

        // 4. Renderizar piezas (solo si están disponibles)
        if (gameState.gameState && gameState.gameState.pieces) {
            console.log("Renderizando piezas base y activas...");
            renderBasePieces(gameState.gameState.pieces);
            renderActivePieces(gameState.gameState.pieces);
        }
        
        // 5. Sincronizar el brillo del turno SOLO si no soy jugador en espera
        if (!isWaitingPlayer && gameState.gameState && gameState.gameState.turn) {
            updateTurnGlow(gameState.gameState.turn.playerIndex);
            updateTurnUI(); // Actualizar UI del turno
        } else if (isWaitingPlayer) {
            // Si soy jugador en espera, deshabilitar todas las interacciones
            if (myDiceContainer) {
                myDiceContainer.style.pointerEvents = 'none';
            }
            console.log('Jugador en espera: Interacciones deshabilitadas');
        }

        // 5. Lógica del botón de inicio (sin cambios)
        if (btnStartGame && gameState.mySeatIndex === gameState.settings.hostSeatIndex && gameState.state === 'waiting') {
            btnStartGame.style.display = 'block';
            // --- INICIO LÓGICA DE HABILITACIÓN DE BOTÓN (REFORZADA) ---
            const seatedPlayers = gameState.seats.filter(s => s !== null).length;
            const gameType = gameState.settings.gameType;
            const parchisMode = gameState.settings.parchisMode;

            let canStart = false;
            let btnText = 'Esperando jugadores...';

            if (gameType === 'parchis' && parchisMode === '4-groups') {
                canStart = (seatedPlayers === 4);
                if (!canStart) {
                    btnText = `Esperando ${4 - seatedPlayers} jugador(es)...`;
                }
            } else if (gameType === 'parchis' && parchisMode === '2-individual') {
                canStart = (seatedPlayers === 2);
                 if (!canStart && seatedPlayers < 2) {
                    btnText = `Esperando oponente...`;
                }
            } else { // Ludo o Parchis 4-individual
                canStart = (seatedPlayers >= 2);
            }

            if (canStart) {
                btnStartGame.disabled = false;
                btnStartGame.textContent = 'Iniciar Juego';
            } else {
                btnStartGame.disabled = true;
                btnStartGame.textContent = btnText;
            }
            // --- FIN LÓGICA DE HABILITACIÓN ---
        }
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    
    // ▼▼▼ LISTENER REEMPLAZADO ▼▼▼
    socket.on('ludoGameStarted', (data) => {
        console.log('El juego de Ludo ha comenzado');

        // Actualizar el estado local
        gameState.gameState = data.gameState;
        gameState.seats = data.seats;
        gameState.state = 'playing';

        // Ocultar el botón de inicio
        if (btnStartGame) {
            btnStartGame.style.display = 'none';
        }

        // Actualizar el bote
        if (gamePotDisplay && gameState.gameState) {
            gamePotDisplay.textContent = `${gameState.gameState.pot} ${gameState.settings.betCurrency || 'USD'}`;
        }

        // Resaltar el turno del primer jugador
        updateTurnGlow(gameState.gameState.turn.playerIndex);

        // Habilitar los dados SÓLO SI es mi turno (soy el primer jugador)
        if (myDiceContainer && gameState.gameState.turn.playerIndex === gameState.mySeatIndex) {
            console.log('Es mi turno. Habilitando dados.');
            myDiceContainer.style.pointerEvents = 'auto';
            
            // ▼▼▼ AÑADE ESTAS LÍNEAS ▼▼▼
            // Los dados 3D ya están inicializados con setupDiceFaces
            // No necesitamos renderizar nada adicional
            // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

        } else {
            myDiceContainer.style.pointerEvents = 'none';
        }
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    
    // ▼▼▼ LISTENER REEMPLAZADO ▼▼▼
    socket.on('ludoTurnChanged', async (data) => {
        console.log(`[Turn Change RCV] Recibido cambio de turno. Esperando fin de animaciones...`);
        
        // 1. ¡BLOQUEO! Esperar a que terminen movimientos o salidas automáticas previos
        await activeAnimationPromise;

        console.log(`[Turn Change EXEC] Aplicando cambio de turno a: ${data.nextPlayerName}`);
        
        // 2. Actualiza el estado del juego local con el que envió el servidor
        gameState.gameState = data.newGameState;
        
        // 3. Actualiza la UI del turno (habilitará/deshabilitará dados)
        updateTurnUI();
        
        // 4. Limpia cualquier resaltado de ficha del turno anterior
        updateClickablePieces(); 
        
        // 5. Actualizar brillo de turno visualmente
        updateTurnGlow(data.nextPlayerIndex);
        
        // 6. Reproducir sonido si es mi turno
        if (data.nextPlayerIndex === gameState.mySeatIndex) {
            playSound('turn');
        }
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    
    socket.on('ludoPieceMoved', (data) => {
        console.log('Pieza movida:', data);
        gameState = data.newState;
        renderLudoBoard(data.newState); // Re-renderizar
    });
    
    socket.on('gameChatUpdate', (data) => {
        const chatWindow = document.getElementById('chat-window');
        const chatNotificationBadge = document.getElementById('chat-notification-badge');
        
        // Si el chat no está visible, reproducir sonido de notificación
        if (chatWindow && !chatWindow.classList.contains('visible')) {
            playSound('notify');
        }
        
        addChatMessage(data.sender, data.text);
    });
    
    socket.on('ludoError', (data) => {
        if (data.message === 'Sala no encontrada') {
            // Si la sala no existe, redirigir al lobby en lugar de mostrar alert
            console.warn('Sala no encontrada, redirigiendo al lobby...');
            window.location.href = '/ludo';
        } else {
            alert(`Error: ${data.message}`);
        }
    });

    // ▼▼▼ REEMPLAZA EL LISTENER 'ludoGameOver' COMPLETO CON ESTAS DOS PARTES ▼▼▼

    /**
     * Muestra el modal de victoria. Esta función es llamada por ludoGameOver
     * después de esperar a que terminen las animaciones.
     * @param {object} data - Los datos del evento ludoGameOver
     */
    function showVictoryModal(data) {
        console.log('Juego terminado. Ganador:', data.winnerName);

        // 1. Ocultar dados y controles de turno
        if (myDiceContainer) {
            myDiceContainer.style.pointerEvents = 'none';
        }
        // Quitar brillo de turno
        updateTurnGlow(-1); // -1 para limpiar todos

        // 2. Mostrar modal de victoria con detalles completos
        const victoryOverlay = document.getElementById('victory-overlay');
        const victoryMessage = document.getElementById('victory-message');
        const finalScores = document.getElementById('final-scores');
        const setupRematchBtn = document.getElementById('btn-setup-rematch');
        
        if (victoryOverlay) {
            // Título con el ganador
            victoryMessage.innerHTML = `¡${data.winnerName} ha ganado la partida!`;
            
            // Preparar HTML con detalles de la partida
            let scoresHTML = '<h3>Detalles de la Partida</h3>';
            scoresHTML += '<div style="margin-bottom: 15px;">';
            scoresHTML += '<p><strong>Participantes:</strong></p>';
            scoresHTML += '<ul style="text-align: left; padding-left: 20px;">';

            const betAmount = gameState?.settings?.bet || 0;
            const betCurrency = gameState?.settings?.betCurrency || 'USD';

            if (data.playersWhoPlayed && data.playersWhoPlayed.length > 0) {
                data.playersWhoPlayed.forEach(player => {
                    // Añadir la apuesta al nombre
                    scoresHTML += `<li>${player} (Apuesta: ${betAmount.toLocaleString('es-ES')} ${betCurrency})</li>`;
                });
            } else {
                scoresHTML += '<li>No disponible</li>'; // Fallback
            }

            scoresHTML += '</ul></div>';

            // Resumen financiero usando los datos del servidor
            const currency = gameState?.settings?.betCurrency || 'USD'; // Obtener moneda de la configuración actual
            
            // ▼▼▼ BLOQUE REEMPLAZADO ▼▼▼
            scoresHTML += '<div style="border-top: 1px solid #555; padding-top: 15px; margin-top: 15px;">';
            scoresHTML += '<p><strong>Resumen Financiero:</strong></p>';
            scoresHTML += `<p>Bote Total: ${data.totalPot?.toLocaleString('es-ES') || 0} ${currency}</p>`;
            scoresHTML += `<p>Comisión Administrativa (10%): ${data.commission?.toLocaleString('es-ES') || 0} ${currency}</p>`;
            
            const totalWinnings = data.finalWinnings?.toLocaleString('es-ES') || 0;
            
            if (data.winningPlayers && data.winningPlayers.length > 1) {
                const individualWinnings = data.winningPlayers[0].winningsRoomCurrency.toLocaleString('es-ES');
                
                scoresHTML += `<p style="color: #6bff6b; font-weight: bold;">Ganancia Total (Pareja): ${totalWinnings} ${currency}</p>`;
                scoresHTML += `<p style="color: #fff; font-size: 0.9em; padding-left: 15px;">(Dividido en: <strong>${individualWinnings} ${currency}</strong> para cada jugador)</p>`;
                
            } else {
                scoresHTML += `<p style="color: #6bff6b; font-weight: bold;">Ganancia del Ganador: ${totalWinnings} ${currency}</p>`;
            }
            
            scoresHTML += '</div>';
            // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲

            finalScores.innerHTML = scoresHTML;
            
            // Mostrar botón de revancha solo si el jugador participó en la partida
            setupRematchBtn.style.display = 'inline-block';
            setupRematchBtn.onclick = setupRematchScreen;
            
            // Mostrar modal
            victoryOverlay.classList.remove('hidden');
            victoryOverlay.style.display = 'flex';
        }
    }

    socket.on('ludoGameOver', async (data) => {
        console.log("-> Recibido 'ludoGameOver'. Esperando a que termine la animación activa (activeAnimationPromise)...");
        
        // ¡LA LÍNEA MÁGICA!
        // Espera a que la promesa de animación actual (si existe) se complete.
        // Si no hay animación, se resuelve inmediatamente.
        await activeAnimationPromise;
        
        console.log("<- Animación finalizada. Mostrando modal de victoria.");
        // Ahora que la animación ha terminado, mostramos el modal.
        showVictoryModal(data);
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    // ▼▼▼ LISTENER PARA REPRODUCIR SONIDOS ▼▼▼
    socket.on('playSound', (soundId) => {
        playSound(soundId);
    });
    // ▲▲▲ FIN DEL LISTENER ▲▲▲

    // ▼▼▼ LISTENER PARA FALTA (MODIFICADO PARA ACEPTAR ABANDONO) ▼▼▼
    socket.on('ludoFoulPenalty', (data) => {
        console.log("🚨 Recibido evento de FALTA/ABANDONO:", data);

        const modal = document.getElementById('foul-modal');
        const detailsEl = document.getElementById('foul-details');
        const acceptBtn = document.getElementById('btn-accept-foul');
        const titleEl = modal ? modal.querySelector('h2') : null; // Seleccionar el título H2
        const staticP = modal ? modal.querySelector('.content > p:not(#foul-details)') : null;

        if (!modal || !detailsEl || !acceptBtn || !titleEl) {
            console.error("No se encontraron los elementos del modal de falta.");
            return;
        }

        if (data.type === 'abandon') {
            console.log('🚨 [FALTA POR ABANDONO] Mostrando modal inmediatamente');
            isFoulPenaltyVisualizing = false;
            penalizedPieceIdDuringFoul = null;
            foulKillingPosition = -1;

            if (staticP) staticP.style.display = 'none';

            titleEl.textContent = '¡FALTA POR ABANDONO!';
            titleEl.style.color = '#ff9800';
            modal.querySelector('.content').style.borderColor = '#ff9800';

            detailsEl.innerHTML = `El jugador <strong>${data.playerName}</strong> ha abandonado la partida.<br>
                               Será eliminado y se le cobrará la apuesta.`;

            // ▼▼▼ CRÍTICO: Mostrar modal INMEDIATAMENTE sin delays ▼▼▼
            modal.style.display = 'flex';
            modal.style.zIndex = '10000'; // Asegurar que esté por encima de todo
            // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
            
            acceptBtn.textContent = 'Aceptar';
            acceptBtn.onclick = () => {
                modal.style.display = 'none';
                titleEl.textContent = '¡FALTA!';
                titleEl.style.color = '#e74c3c';
                modal.querySelector('.content').style.borderColor = '#e74c3c';
                if (staticP) staticP.style.display = 'block';
            };

        } else if (data.type === 'three_doubles') {
            // --- NUEVO CASO: TRES DOBLES ---
            isFoulPenaltyVisualizing = false;
            penalizedPieceIdDuringFoul = null;
            foulKillingPosition = -1;

            if (staticP) staticP.style.display = 'none'; // Ocultar "Era obligatorio matar"

            titleEl.textContent = '¡FALTA POR 3 DOBLES!';
            titleEl.style.color = '#e74c3c'; // Rojo
            modal.querySelector('.content').style.borderColor = '#e74c3c';

            detailsEl.innerHTML = `El jugador <strong>${data.playerName}</strong> sacó tres dobles seguidos.<br>
                               La última ficha movida (<strong>${data.penalizedPieceId}</strong>) vuelve a la base.`;

            modal.style.display = 'flex';
            acceptBtn.textContent = 'Aceptar';
            acceptBtn.onclick = () => {
                modal.style.display = 'none';
                titleEl.textContent = '¡FALTA!'; // Resetear título
                if (staticP) staticP.style.display = 'block'; // Resetear <p>
                
                // Forzar re-renderizado para mostrar la ficha en la base
                if (gameState && gameState.gameState) {
                    renderBasePieces(gameState.gameState.pieces);
                    renderActivePieces(gameState.gameState.pieces);
                }
            };

        } else {
            if (staticP) staticP.style.display = 'block';
            const { penalizedPieceId, killingPieceId, playerColor, killingPiecePosition, targetKillPosition, targetPieceId } = data;

            penalizedPieceIdDuringFoul = penalizedPieceId;
            foulKillingPosition = killingPiecePosition;
            isFoulPenaltyVisualizing = true;

            const targetCellElement = document.querySelector(`[data-cell="${targetKillPosition}"]`);
            const killingCellElement = document.querySelector(`[data-cell="${killingPiecePosition}"]`);
            const killingPieceElement = document.getElementById(killingPieceId);
            const targetPieceElement = document.getElementById(targetPieceId);

            console.log(`[FALTA VISUAL] Aplicando resaltados NARANJA (ficha que podía matar) y VERDE (objetivo)...`);
            if (gameState && gameState.gameState) {
                renderActivePieces(gameState.gameState.pieces);
            }
            
            // Animación NARANJA FLUORESCENTE para la ficha y casilla que podía matar
            if (killingPieceElement) {
                killingPieceElement.classList.add('penalty-highlight-orange');
            }
            if (killingCellElement) {
                killingCellElement.classList.add('killing-piece-highlight');
            }
            
            // Animación VERDE FLUORESCENTE para la ficha y casilla objetivo
            if (targetPieceElement) {
                targetPieceElement.classList.add('target-piece-highlight-green');
            }
            if (targetCellElement) {
                targetCellElement.classList.add('target-kill-highlight');
            }

            setTimeout(() => {
                console.log("[FALTA VISUAL] Terminó resaltado de 6s.");
                if (targetCellElement) targetCellElement.classList.remove('target-kill-highlight');
                if (killingCellElement) killingCellElement.classList.remove('killing-piece-highlight');
                if (killingPieceElement) killingPieceElement.classList.remove('penalty-highlight-orange');
                if (targetPieceElement) targetPieceElement.classList.remove('target-piece-highlight-green');

                if (modal && detailsEl && acceptBtn) {
                    console.log("[FALTA VISUAL] Mostrando modal.");
                    titleEl.textContent = '¡FALTA!';
                    titleEl.style.color = '#e74c3c';
                    modal.querySelector('.content').style.borderColor = '#e74c3c';

                    detailsEl.innerHTML = `La ficha <strong>${killingPieceId}</strong> (en ${killingPiecePosition}) podía matar a <strong>${targetPieceId || 'una ficha'}</strong> en <strong>${targetKillPosition}</strong>.<br>La ficha <strong>${penalizedPieceId}</strong> vuelve a casa.`;
                    modal.style.display = 'flex';
                    acceptBtn.textContent = 'Aceptar';

                    acceptBtn.onclick = () => {
                        modal.style.display = 'none';
                        isFoulPenaltyVisualizing = false;
                        penalizedPieceIdDuringFoul = null;
                        foulKillingPosition = -1;

                        if (gameState && gameState.gameState) {
                            console.log(`[FALTA VISUAL] Modal aceptado. Forzando re-renderizado final (ficha a la base).`);
                            renderBasePieces(gameState.gameState.pieces);
                            renderActivePieces(gameState.gameState.pieces);
                            updateClickablePieces();
                            updateTurnUI();
                        }
                    };
                } else {
                    console.warn("[FALTA VISUAL] Modal no encontrado, limpiando bandera y re-renderizando.");
                    isFoulPenaltyVisualizing = false;
                    penalizedPieceIdDuringFoul = null;
                    foulKillingPosition = -1;
                    if (gameState && gameState.gameState) {
                        renderBasePieces(gameState.gameState.pieces);
                        renderActivePieces(gameState.gameState.pieces);
                        updateClickablePieces();
                        updateTurnUI();
                    }
                }
            }, 6000);
        }
    });
    // ▲▲▲ FIN DEL LISTENER MODIFICADO ▲▲▲

    // ▼▼▼ FIX: Listener para cuando el juego termina por abandono - redirigir al jugador que abandonó ▼▼▼
    socket.on('gameEnded', (data) => {
        console.log('[gameEnded] El juego terminó:', data);
        if (data.redirect) {
            // ▼▼▼ CRÍTICO: Preservar userId, username, avatar y currency en sessionStorage Y localStorage antes de redirigir (para PWA) ▼▼▼
            // Priorizar los datos enviados por el servidor si están disponibles
            let userId = data.userId || sessionStorage.getItem('userId') || localStorage.getItem('userId');
            let username = data.username || sessionStorage.getItem('username') || localStorage.getItem('username');
            let userAvatar = data.avatar || sessionStorage.getItem('userAvatar') || localStorage.getItem('userAvatar');
            let userCurrency = data.userCurrency || sessionStorage.getItem('userCurrency') || localStorage.getItem('userCurrency');
            
            // Si no hay username, intentar recuperarlo desde userId
            if (!username && userId) {
                username = userId.replace('user_', '');
            }
            
            // Si no hay userId, intentar recuperarlo desde username
            if (!userId && username) {
                userId = 'user_' + username.toLowerCase();
            }
            
            // Guardar en ambos lugares para persistencia en PWA
            if (userId) {
                sessionStorage.setItem('userId', userId);
                localStorage.setItem('userId', userId);
            }
            if (username) {
                sessionStorage.setItem('username', username);
                localStorage.setItem('username', username);
            }
            if (userAvatar) {
                sessionStorage.setItem('userAvatar', userAvatar);
                localStorage.setItem('userAvatar', userAvatar);
            }
            if (userCurrency) {
                sessionStorage.setItem('userCurrency', userCurrency);
                localStorage.setItem('userCurrency', userCurrency);
            }
            
            console.log('[gameEnded] Datos preservados antes de redirigir - userId:', userId, 'username:', username, 'avatar:', userAvatar, 'currency:', userCurrency);
            // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
            
            // Redirigir al lobby con mensaje apropiado
            // IMPORTANTE: NO desconectar el socket, solo redirigir
            setTimeout(() => {
                let message = data.message || 'El juego terminó.';
                if (data.reason === 'abandonment') {
                    message = `Has sido eliminado por abandono.`;
                    if (data.penalty && data.currency) {
                        message += `\n\nSe te ha descontado la apuesta de ${data.penalty} ${data.currency}.`;
                    }
                } else if (data.reason === 'room_not_found') {
                    message = data.message || 'La sala ya no existe. Puede que hayas sido eliminado por abandono.';
                }
                if (data.winner) {
                    message += `\n\nEl ganador fue: ${data.winner}`;
                }
                alert(message);
                // Redirigir sin desconectar el socket
                window.location.href = '/ludo';
            }, 1000);
        }
    });
    
    // Listener para errores de sala
    socket.on('ludoError', (data) => {
        console.log('[ludoError]', data);
        if (data.message && (data.message.includes('no existe') || data.message.includes('no encontrada'))) {
            setTimeout(() => {
                alert('La sala ya no existe. Puede que hayas sido eliminado por abandono.');
                window.location.href = '/ludo';
            }, 1000);
        }
    });
    
    socket.on('joinRoomFailed', (data) => {
        console.log('[joinRoomFailed]', data);
        if (data.message && (data.message.includes('no existe') || data.message.includes('no encontrada'))) {
            setTimeout(() => {
                alert('La sala ya no existe. Puede que hayas sido eliminado por abandono.');
                window.location.href = '/ludo';
            }, 1000);
        }
    });
    
    // Listener para cuando un jugador se desconecta temporalmente
    socket.on('playerDisconnected', (data) => {
        console.log('[playerDisconnected]', data);
        if (data && data.message) {
            // ▼▼▼ FIX: Usar window.showToast o alert como fallback ▼▼▼
            if (typeof window.showToast === 'function') {
                window.showToast(data.message, 3000);
            } else if (typeof showToast === 'function') {
                showToast(data.message, 3000);
            } else {
                console.log('[playerDisconnected]', data.message);
            }
            // ▲▲▲ FIN DEL FIX ▲▲▲
        }
    });
    
    // Listener para cuando un jugador se reconecta
    socket.on('playerReconnected', (data) => {
        console.log('[playerReconnected]', data);
        if (data && data.message) {
            // ▼▼▼ FIX: Usar window.showToast o alert como fallback ▼▼▼
            if (typeof window.showToast === 'function') {
                window.showToast(data.message, 3000);
            } else if (typeof showToast === 'function') {
                showToast(data.message, 3000);
            } else {
                console.log('[playerReconnected]', data.message);
            }
            // ▲▲▲ FIN DEL FIX ▲▲▲
        }
        // ▼▼▼ CRÍTICO: Sincronizar estado cuando un jugador se reconecta ▼▼▼
        // Solicitar actualización del estado del juego
        if (gameState && gameState.roomId) {
            socket.emit('requestGameState', { roomId: gameState.roomId });
        }
        // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    });
    
    socket.on('playerLeft', (roomData) => {
        console.log('[playerLeft] Un jugador ha salido:', roomData);
        
        // ▼▼▼ CRÍTICO: Actualizar asientos cuando un jugador abandona y notificar ▼▼▼
        if (roomData && roomData.seats && gameState) {
            console.log('[playerLeft] Actualizando asientos después de que un jugador abandonó');
            
            // Contar jugadores antes y después para detectar si alguien abandonó
            const playersBefore = gameState.seats.filter(s => s !== null).length;
            gameState.seats = roomData.seats;
            const playersAfter = gameState.seats.filter(s => s !== null).length;
            
            // Si hay menos jugadores, alguien abandonó
            if (playersAfter < playersBefore) {
                const notificationMessage = 'Un jugador ha abandonado la partida.';
                if (typeof window.showToast === 'function') {
                    window.showToast(notificationMessage, 5000);
                } else if (typeof showToast === 'function') {
                    showToast(notificationMessage, 5000);
                } else {
                    console.log('[playerLeft]', notificationMessage);
                }
            }
            
            // Re-renderizar el tablero para reflejar los cambios
            renderLudoBoard(gameState);
        }
        // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
        
        // Si el estado del juego es post-game y no somos el ganador, verificar si debemos salir
        if (gameState && gameState.state === 'post-game') {
            const mySeat = gameState.seats.find(s => s && s.playerId === socket.id);
            // Si no tenemos asiento o el asiento está null, redirigir al lobby
            if (!mySeat) {
                console.log('[playerLeft] No tenemos asiento, redirigiendo al lobby');
                setTimeout(() => {
                    window.location.href = '/ludo';
                }, 2000);
            }
        }
    });
    // ▲▲▲ FIN DEL FIX ▲▲▲
    
    // ▼▼▼ REEMPLAZA TU LISTENER 'ludoGameStateUpdated' COMPLETO CON ESTE ▼▼▼
    socket.on('ludoGameStateUpdated', async (data) => { // Añade async
        
        // ▼▼▼ LOG AL INICIO ▼▼▼
        console.log(`[CLIENT MOVE RCV] Recibido ludoGameStateUpdated. newGameState.turn.moves: ${data.newGameState?.turn?.moves?.join(', ') || 'N/A'}`);
        // ▲▲▲ FIN LOG ▲▲▲
        console.log('Estado del juego actualizado:', data.moveInfo);

        // --- INICIO DE LA LÓGICA DE BLOQUEO (LOCK) ---
        // 1. Crear una promesa controlable para esta actualización
        let updateResolver;
        const updatePromise = new Promise(resolve => {
            updateResolver = resolve;
        });
        
        // 2. Encadenar esta promesa a la cola de animaciones global
        // 'ludoGameOver' esperará a que esta cadena se resuelva.
        activeAnimationPromise = activeAnimationPromise.then(() => updatePromise);
        // --- FIN DE LA LÓGICA DE BLOQUEO ---

        // 3. Guarda el nuevo estado pero NO lo apliques aún
        const newGameState = data.newGameState;
        const moveInfo = data.moveInfo;

        // ▼▼▼ FIX: Manejar caso de abandono - redirigir al jugador que abandonó ▼▼▼
        if (moveInfo && moveInfo.type === 'game_over_abandonment') {
            console.log('[ludoGameStateUpdated] Juego terminó por abandono. Jugador que abandonó:', moveInfo.leavingPlayer);
            // Verificar si somos el jugador que abandonó
            const mySeat = gameState.seats.find(s => s && s.playerId === socket.id);
            if (mySeat && mySeat.playerName === moveInfo.leavingPlayer) {
                // Somos el jugador que abandonó, redirigir al lobby después de un breve delay
                setTimeout(() => {
                    alert(`Has abandonado la partida. El ganador fue: ${moveInfo.winner}`);
                    window.location.href = '/ludo';
                }, 2000);
                return; // No procesar más actualizaciones
            }
        }
        // ▲▲▲ FIN DEL FIX ▲▲▲
        
        // ▼▼▼ CRÍTICO: Manejar caso de jugador abandonado - actualizar asientos y notificar ▼▼▼
        if (moveInfo && moveInfo.type === 'player_abandoned') {
            console.log('[ludoGameStateUpdated] Un jugador abandonó:', moveInfo.playerName);
            // Actualizar asientos si se proporcionan
            if (data.seats) {
                gameState.seats = data.seats;
                renderLudoBoard(gameState);
                console.log('[ludoGameStateUpdated] Asientos actualizados después de abandono');
            }
            
            // ▼▼▼ CRÍTICO: Mostrar notificación al jugador que quedó en la mesa ▼▼▼
            const notificationMessage = `El jugador ${moveInfo.playerName} ha abandonado la partida.`;
            if (typeof window.showToast === 'function') {
                window.showToast(notificationMessage, 5000);
            } else if (typeof showToast === 'function') {
                showToast(notificationMessage, 5000);
            } else {
                console.log('[ludoGameStateUpdated]', notificationMessage);
            }
            // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
        }
        // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
        
        // ▼▼▼ FIX: Manejar caso de reconexión - sincronizar estado sin animar ▼▼▼
        if (moveInfo && moveInfo.type === 'reconnect_sync') {
            console.log('[ludoGameStateUpdated] Sincronización de reconexión. Actualizando estado completo sin animar.');
            // Sincronizar estado completo sin animar movimientos
            gameState.gameState = newGameState;
            if (data.seats) {
                gameState.seats = data.seats;
                renderLudoBoard(gameState);
            }
            // Renderizar fichas en su posición actual
            renderBasePieces(gameState.gameState.pieces);
            renderActivePieces(gameState.gameState.pieces);
            // Actualizar UI del turno
            updateTurnUI();
            updateClickablePieces();
            // Resolver la promesa inmediatamente (sin esperar animaciones)
            updateResolver();
            return; // No procesar más (no animar movimientos)
        }
        // ▲▲▲ FIN DEL FIX ▲▲▲
        
        // 4. ¿Hubo un movimiento de ficha activa con ruta? -> Animar
        if (moveInfo && moveInfo.type === 'move_active_piece' && moveInfo.movePath && moveInfo.movePath.length > 0) {
             await animatePieceStep(moveInfo.pieceId, moveInfo.movePath); // Espera a que termine la animación
             
             // Reproducir el sonido final después de la animación (muerte, meta, bloqueo)
             if (moveInfo.finalSound) {
                 playSound(moveInfo.finalSound);
             }
        }
        // Si fue 'auto_release_all', también podríamos animar, pero es más complejo

        // --- SOLO DESPUÉS de la animación (o si no hubo animación) ---
        // 5. Aplica el nuevo estado del juego local (CON PRECAUCIÓN)
        
        // Obtenemos el índice del turno que TENEMOS AHORA
        const currentTurnIndex = gameState.gameState.turn.playerIndex;
        // Obtenemos el índice del turno que VIENE EN EL MENSAJE
        const newTurnIndex = newGameState.turn.playerIndex;
        
        // Si el índice del turno del mensaje (newTurnIndex) es DIFERENTE al que ya tenemos (currentTurnIndex)
        // (p.ej., 'ludoTurnChanged' ya actualizó al jugador 2, pero este mensaje viejo del jugador 1 llegó tarde)
        // entonces, SOLO actualizamos las fichas, porque el estado del TURNO que tenemos es más nuevo.
        if (currentTurnIndex !== newTurnIndex) {
            console.warn(`[CLIENT RACE] Se ignoró la actualización de 'turn' (Actual: ${currentTurnIndex}, Recibido: ${newTurnIndex}). Solo se actualizan las fichas.`);
            gameState.gameState.pieces = newGameState.pieces; 
        } else {
            console.log(`[CLIENT MOVE STORE] Actualizando gameState.turn... Moves AHORA: ${newGameState?.turn?.moves?.join(', ') || 'N/A'}`);
            gameState.gameState = newGameState; 
        }

        if (data.seats) {
            console.log("[ludoGameStateUpdated] Sincronizando asientos con datos del servidor.");
            gameState.seats = data.seats;
            renderLudoBoard(gameState);
        }

        // 6. Vuelve a dibujar TODO el tablero basado en el NUEVO estado
        renderBasePieces(gameState.gameState.pieces);
        renderActivePieces(gameState.gameState.pieces);

        // 7. Actualiza la UI del turno
        updateTurnUI();

        // 8. Limpia cualquier resaltado de ficha
        updateClickablePieces();

        // 9. ¡RESOLVER LA PROMESA!
        // Esto le dice a 'ludoGameOver' (si está esperando) que puede continuar.
        console.log("-> Animación de movimiento completada. Liberando el bloqueo (updateResolver).");
        updateResolver();
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    // ▼▼▼ LISTENER DE ERRORES DE REVANCHA (CRÉDITOS) ▼▼▼
    socket.on('rematchError', (data) => {
        console.error('Error en la revancha:', data?.message);

        if (data && data.insufficientCredits) {
            if (typeof window.showToast === 'function') {
                window.showToast(data.message, 5000);
            } else {
                alert(data.message);
            }

            const mainButton = document.getElementById('btn-ready-main');
            if (mainButton) {
                mainButton.disabled = true;
                mainButton.textContent = 'Créditos Insuficientes';
            }
            const startButton = document.getElementById('btn-start-rematch');
            if (startButton) startButton.style.display = 'none';
        } else {
            if (typeof window.showToast === 'function') {
                window.showToast(`Error: ${data?.message || 'Problema de revancha'}`, 4000);
            } else {
                alert(`Error: ${data?.message || 'Problema de revancha'}`);
            }
        }
    });
    // ▲▲▲ FIN LISTENER DE ERRORES DE REVANCHA ▲▲▲

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER ▼▼▼
    let activeAnimationIntervals = {}; // Objeto para guardar los intervalos activos por jugador

    socket.on('ludoDiceRolling', (data) => {
        const { playerId, playerName } = data;
        console.log(`<- Recibido: ${playerName} (${playerId}) está lanzando dados.`);

        // Limpia cualquier animación anterior para este jugador (seguridad)
        if (activeAnimationIntervals[playerId]) {
            clearInterval(activeAnimationIntervals[playerId]);
        }

        // Encuentra los dados del jugador que está lanzando
        const { diceEl1, diceEl2 } = findDiceElementsForPlayer(playerId);

        if (diceEl1 && diceEl2) {
            // Inicia la animación y guarda el ID del intervalo
            activeAnimationIntervals[playerId] = animateDice(diceEl1, diceEl2);
        } else {
            console.warn(`No se encontraron los dados para animar para ${playerName}`);
        }
    });

    // --- Función de ayuda para encontrar dados (necesaria para 'ludoDiceRolling') ---
    function findDiceElementsForPlayer(playerId) {
        if (!gameState) return { diceEl1: null, diceEl2: null };

        const seatIndex = gameState.seats.findIndex(s => s && s.playerId === playerId);
        if (seatIndex === -1) return { diceEl1: null, diceEl2: null };

        const rotationOffset = gameState.mySeatIndex;
        const rotatedSeats = rotateArray(gameState.seats, rotationOffset);
        const physicalIndex = rotatedSeats.findIndex(s => s && s.playerId === playerId);
        if (physicalIndex === -1) return { diceEl1: null, diceEl2: null };

        const physicalSlot = PHYSICAL_SLOTS[physicalIndex];
        const diceEl1 = document.getElementById(`player-dice-${physicalSlot}-1`);
        const diceEl2 = document.getElementById(`player-dice-${physicalSlot}-2`);
        return { diceEl1, diceEl2 };
    }
    // ▲▲▲ FIN DEL LISTENER Y FUNCIÓN AUXILIAR ▲▲▲

    // 4. Eventos del Cliente (Clics)

    // --- INICIO: LÓGICA DE DADOS (INDIVIDUALES) ---

    // Debido a la rotación de la vista, TUS dados siempre están en el slot 'yellow'
    // myDiceContainer ya está declarado arriba
    const myDice1 = document.getElementById('player-dice-yellow-1');
    const myDice2 = document.getElementById('player-dice-yellow-2');

    /* ▼▼▼ FUNCIÓN ANTIGUA renderDice - COMENTADA (Ahora usamos dados cubo 3D) ▼▼▼
    /**
     * Dibuja los puntos en un dado según su valor (del 1 al 6)
     * @param {HTMLElement} diceElement - El div del dado
     * @param {number} value - El valor (1-6)
     *
    function renderDice(diceElement, value) {
        if (!diceElement) return;
        diceElement.innerHTML = ''; // Limpiar puntos anteriores
        diceElement.dataset.value = value;

        const dots = [];
        if (value === 1) dots.push(5); // Centro
        if (value === 2) dots.push(1, 9); // Esquinas opuestas
        if (value === 3) dots.push(1, 5, 9); // Diagonal
        if (value === 4) dots.push(1, 3, 7, 9); // 4 esquinas
        if (value === 5) dots.push(1, 3, 5, 7, 9); // 4 esquinas + centro
        if (value === 6) dots.push(1, 3, 4, 6, 7, 9); // 2 columnas de 3

        for (let i = 1; i <= 9; i++) {
            const dot = document.createElement('div');
            if (dots.includes(i)) {
                dot.className = 'dice-dot';
            }
            dot.style.gridArea = `${Math.ceil(i/3)} / ${((i-1)%3)+1}`;
            diceElement.appendChild(dot);
        }
    }
    ▲▲▲ FIN FUNCIÓN ANTIGUA ▲▲▲ */

    /**
     * Añade los puntos a las caras de un dado cubo 3D.
     * @param {HTMLElement} diceElement - El div del cubo (ej: myDice1).
     */
    function setupDiceFaces(diceElement) {
        if (!diceElement) return;
        const facesData = [
            { faceClass: 'front', value: 1, dots: ['p5'] },
            { faceClass: 'back', value: 6, dots: ['p1', 'p3', 'p4', 'p6', 'p7', 'p9'] },
            { faceClass: 'right', value: 3, dots: ['p1', 'p5', 'p9'] },
            { faceClass: 'left', value: 4, dots: ['p1', 'p3', 'p7', 'p9'] },
            { faceClass: 'top', value: 2, dots: ['p1', 'p9'] },
            { faceClass: 'bottom', value: 5, dots: ['p1', 'p3', 'p5', 'p7', 'p9'] }
        ];

        facesData.forEach(data => {
            const face = diceElement.querySelector(`.face.${data.faceClass}`);
            if (face) {
                face.innerHTML = ''; // Limpiar por si acaso
                face.dataset.value = data.value; // Guardar valor para referencia
                data.dots.forEach(dotClass => {
                    const dot = document.createElement('div');
                    dot.className = `dot ${dotClass}`;
                    face.appendChild(dot);
                });
            }
        });
    }

    // ▼▼▼ INICIALIZAR DADOS CUBO 3D ▼▼▼
    // Inicializar todos los dados (8 en total: 2 por cada color)
    const allDiceIds = [
        'player-dice-yellow-1', 'player-dice-yellow-2',
        'player-dice-green-1', 'player-dice-green-2',
        'player-dice-red-1', 'player-dice-red-2',
        'player-dice-blue-1', 'player-dice-blue-2'
    ];
    
    allDiceIds.forEach(diceId => {
        const diceElement = document.getElementById(diceId);
        if (diceElement) {
            setupDiceFaces(diceElement);
        }
    });
    // ▲▲▲ FIN INICIALIZACIÓN ▲▲▲

    /**
     * Inicia la animación de lanzamiento para un par de dados específico.
     * @param {HTMLElement} diceEl1 - El primer elemento del dado.
     * @param {HTMLElement} diceEl2 - El segundo elemento del dado.
     * @returns {number | null} - El ID del intervalo de animación, o null si falla.
     */
    function animateDice(diceEl1, diceEl2) {
        if (!diceEl1 || !diceEl2) {
            console.error("Error en animateDice: Elementos de dado no válidos.");
            return null;
        }
        console.log(`🎲 Iniciando animación para dados: ${diceEl1.id}, ${diceEl2.id}`);

        // Quitar transiciones para permitir cambios rápidos
        diceEl1.style.transition = 'none';
        diceEl2.style.transition = 'none';

        // Inicia el intervalo CON ROTACIONES ACUMULATIVAS PARA GIROS RÁPIDOS
        let rotationX1 = 0, rotationY1 = 0, rotationZ1 = 0;
        let rotationX2 = 0, rotationY2 = 0, rotationZ2 = 0;
        
        const intervalId = setInterval(() => {
            // Asegurarse de que los dados existen DENTRO del intervalo
            if (!document.body.contains(diceEl1) || !document.body.contains(diceEl2)) {
                console.error("Error dentro del intervalo: Elementos de dado desaparecieron.");
                clearInterval(intervalId);
                return;
            }

            // ▼▼▼ FUERZA 'transition: none' EN CADA PASO ▼▼▼
            // Asegura que no haya transición entre pasos rápidos
            diceEl1.style.transition = 'none';
            diceEl2.style.transition = 'none';

            // ▼▼▼ REDUCE LOS VALORES PARA GIROS MÁS LENTOS (aprox. 15 vueltas) ▼▼▼
            // Antes: Math.random() * 180 + 90 -> Promedio 180° por paso
            // Ahora: Math.random() * 138 + 60 -> Promedio ~129° por paso
            rotationX1 += Math.random() * 138 + 60; // Reducido
            rotationY1 += Math.random() * 138 + 60; // Reducido
            rotationZ1 += Math.random() * 138 + 60; // Reducido
            diceEl1.style.setProperty('transform', `rotateX(${rotationX1}deg) rotateY(${rotationY1}deg) rotateZ(${rotationZ1}deg)`, 'important');

            rotationX2 += Math.random() * 138 + 60; // Reducido
            rotationY2 += Math.random() * 138 + 60; // Reducido
            rotationZ2 += Math.random() * 138 + 60; // Reducido
            diceEl2.style.setProperty('transform', `rotateX(${rotationX2}deg) rotateY(${rotationY2}deg) rotateZ(${rotationZ2}deg)`, 'important');
            // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲

        }, 50); // Mantenemos el intervalo rápido (20 frames por segundo)

        console.log("Intervalo de animación iniciado con ID:", intervalId);
        return intervalId; // Devuelve el ID para poder detenerlo
    }
    
    /**
     * Función que se llama al hacer clic en mis dados
     */
    function handleRollClick() {
        console.log("🖱️ Clic en mis dados detectado (handleRollClick)");
        
        // ▼▼▼ CORRECCIÓN: Verificar si el jugador está en espera ▼▼▼
        const mySeat = gameState?.seats?.find(s => s && s.playerId === socket.id);
        if (mySeat && mySeat.status === 'waiting') {
            console.warn("handleRollClick: Jugador en espera, acción bloqueada");
            return;
        }
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
        
        // Validar si es mi turno y puedo tirar
        if (!gameState || !gameState.gameState || !gameState.gameState.turn ||
            gameState.gameState.turn.playerIndex !== gameState.mySeatIndex ||
            !gameState.gameState.turn.canRoll)
        {
           console.warn("handleRollClick: Clic inválido (No es mi turno o no puedo tirar). Estado:", gameState?.gameState?.turn);
           // Restaura pointerEvents si se deshabilitó erróneamente
           if (myDiceContainer) myDiceContainer.style.pointerEvents = 'auto';
           return;
        }

        // Deshabilita los dados inmediatamente para evitar doble clic
        if (myDiceContainer) myDiceContainer.style.pointerEvents = 'none';

        // Solo emite la solicitud al servidor (YA NO llama a animateDice)
        socket.emit('ludoRollDice', { roomId });
        console.log("-> Enviando ludoRollDice al servidor");
    }

    // Asignar listeners a mis dados
    if (myDiceContainer) {
        // Habilitar/Deshabilitar mis dados (empezamos deshabilitados)
        myDiceContainer.style.pointerEvents = 'none'; 
        myDiceContainer.style.cursor = 'pointer';
        myDiceContainer.addEventListener('click', handleRollClick);
    }

    // ▼▼▼ AÑADE ESTE LISTENER ▼▼▼
    if (btnStartGame) {
        btnStartGame.addEventListener('click', () => {
            console.log('Enviando solicitud para iniciar el juego...');
            btnStartGame.disabled = true;
            btnStartGame.textContent = 'Iniciando...';
            socket.emit('ludoStartGame', { roomId });
        });
    }
    // ▲▲▲ FIN DEL LISTENER ▲▲▲
    
    // --- FIN: LÓGICA DE DADOS (INDIVIDUALES) ---

    // ▼▼▼ LISTENER DE DADOS ACTUALIZADO ▼▼▼
    // ▼▼▼ REEMPLAZA TU LISTENER 'ludoDiceRolled' COMPLETO CON ESTE ▼▼▼
    socket.on('ludoDiceRolled', (data) => {
        // ▼▼▼ LOG AL INICIO (SIN CAMBIOS) ▼▼▼
        console.log(`[CLIENT DICE RCV] Recibido ludoDiceRolled. diceValues: ${data.diceValues.join(', ')}, turnData.moves: ${data.turnData?.moves?.join(', ') || 'N/A'}`);
        // ▲▲▲ FIN LOG ▲▲▲
        console.log(`<- Recibido [DADOS] ${data.playerName} sacó:`, data.diceValues);
        const { playerId, diceValues, isDouble } = data;

        const MIN_ANIMATION_TIME = 1000; 

        // --- INICIO DE LA CORRECCIÓN (REFACTORIZACIÓN) ---

        // 1. ACTUALIZAR EL ESTADO DEL JUEGO INMEDIATAMENTE
        // Esto previene la "race condition" del doble clic.
        const isMyRoll = (playerId === myPlayerId);
        if (isMyRoll) {
            console.log(`[CLIENT DICE STORE] Actualizando gameState.turn INMEDIATAMENTE. Moves AHORA: ${data.turnData?.moves?.join(', ') || 'N/A'}`);
            // Aplicamos los datos del turno al estado local AHORA
            gameState.gameState.turn = data.turnData;
        }

        // 2. INICIAR EL TEMPORIZADOR PARA LA ANIMACIÓN VISUAL
        setTimeout(() => {
            // 3. DETENER LA ANIMACIÓN DE GIRO
            if (activeAnimationIntervals[playerId]) {
                console.log(`⏹️ Deteniendo animación para ${playerId} (Intervalo: ${activeAnimationIntervals[playerId]})`);
                clearInterval(activeAnimationIntervals[playerId]);
                delete activeAnimationIntervals[playerId];
            } else {
                console.warn(`No se encontró intervalo de animación activo para detener para ${playerId}`);
            }

            // 4. MOSTRAR EL RESULTADO FINAL DE LOS DADOS
            const { diceEl1, diceEl2 } = findDiceElementsForPlayer(playerId);

            if (diceEl1 && diceEl2) {
                // Quita CUALQUIER transform inline
                diceEl1.style.removeProperty('transform');
                diceEl2.style.removeProperty('transform');
                
                // Restaura la transición CSS para la rotación final
                diceEl1.style.transition = 'transform 1s ease-out';
                diceEl2.style.transition = 'transform 1s ease-out';
                
                // Aplica la rotación final (SIN !important)
                const rotations = {
                    1: 'rotateX(0deg) rotateY(0deg)',
                    6: 'rotateX(0deg) rotateY(180deg)',
                    3: 'rotateX(0deg) rotateY(-90deg)',
                    4: 'rotateX(0deg) rotateY(90deg)',
                    2: 'rotateX(-90deg) rotateY(0deg)',
                    5: 'rotateX(90deg) rotateY(0deg)'
                };
                diceEl1.style.transform = rotations[diceValues[0]] || rotations[1];
                diceEl2.style.transform = rotations[diceValues[1]] || rotations[1];
            }

            // 5. ESPERAR A QUE TERMINE LA ROTACIÓN FINAL
            const FINAL_ROTATION_WAIT = 1000;
            
            setTimeout(() => {
                // 6. ACTUALIZAR LA UI (MOSTRAR MOVIMIENTOS, HABILITAR/DESHABILITAR DADOS)
                // El estado ya está actualizado, solo refrescamos la UI basada en él.
                if (isMyRoll) {
                    // Usamos data.turnData (que es el mismo que gameState.gameState.turn)
                    if (data.turnData.possibleMoves && data.turnData.possibleMoves.length > 0) {
                        console.log("UI: Actualizando piezas clicables (post-animación)");
                        updateClickablePieces();
                    }
                }
                console.log("UI: Actualizando UI de turno (post-animación)");
                updateTurnUI(); // Esto leerá el estado (canRoll: false) y deshabilitará los dados

            }, FINAL_ROTATION_WAIT);
            // --- FIN DE LA CORRECCIÓN ---

        }, MIN_ANIMATION_TIME);
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    
    document.getElementById('chat-send-btn').addEventListener('click', () => {
        sendChatMessage();
    });
    
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

    // ▼▼▼ AÑADE ESTE BLOQUE DE LISTENERS ▼▼▼

    // --- 1. Botón "Volver al Lobby" ---
    const btnBackToLobby = document.getElementById('btn-back-to-lobby-ingame');
    const confirmLeaveModal = document.getElementById('confirm-leave-modal');
    const btnConfirmLeaveYes = document.getElementById('btn-confirm-leave-yes');
    const btnConfirmLeaveNo = document.getElementById('btn-confirm-leave-no');

    if (btnBackToLobby && confirmLeaveModal && btnConfirmLeaveYes && btnConfirmLeaveNo) {
        // Abrir modal de confirmación
        btnBackToLobby.addEventListener('click', () => {
            confirmLeaveModal.style.display = 'flex';
        });

        // Botón "No" (cerrar modal)
        btnConfirmLeaveNo.addEventListener('click', () => {
            confirmLeaveModal.style.display = 'none';
        });

        // Botón "Sí" (volver al lobby)
        btnConfirmLeaveYes.addEventListener('click', () => {
            // ▼▼▼ CRÍTICO: Emitir leaveGame ANTES de redirigir para eliminar al jugador inmediatamente ▼▼▼
            if (gameState && gameState.roomId) {
                console.log('[btnConfirmLeaveYes] Emitiendo leaveGame para eliminar jugador inmediatamente de sala:', gameState.roomId);
                socket.emit('leaveGame', { roomId: gameState.roomId });
            }
            // Cerrar modal
            confirmLeaveModal.style.display = 'none';
            // Pequeño delay para asegurar que el servidor procese el leaveGame antes de redirigir
            setTimeout(() => {
                window.location.href = '/ludo';
            }, 200);
            // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
        });
    }

    // --- 2. Botón "Reglas Ludo" ---
    const btnGameRules = document.getElementById('game-rules-btn');
    const rulesModal = document.getElementById('rules-modal');
    const btnCloseRules = document.getElementById('btn-close-rules-modal');
    const closeModalBtn = rulesModal ? rulesModal.querySelector('.close-modal-btn') : null;

    if (btnGameRules && rulesModal) {
        // Abrir modal de reglas - usar 'block' igual que el lobby
        btnGameRules.addEventListener('click', () => {
            rulesModal.style.display = 'block';
            rulesModal.style.setProperty('display', 'block', 'important');
        });

        // Cerrar modal de reglas con botón "Entendido"
        if (btnCloseRules) {
            btnCloseRules.addEventListener('click', () => {
                rulesModal.style.display = 'none';
                rulesModal.style.setProperty('display', 'none', 'important');
            });
        }

        // Cerrar modal con botón X
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                rulesModal.style.display = 'none';
                rulesModal.style.setProperty('display', 'none', 'important');
            });
        }
        
        // Cerrar si se hace clic fuera del contenido (en el overlay)
        rulesModal.addEventListener('click', (e) => {
            if (e.target === rulesModal) {
                rulesModal.style.display = 'none';
                rulesModal.style.setProperty('display', 'none', 'important');
            }
        });
    }

    // --- 3. Botón "Chat" ---
    const chatToggleButton = document.getElementById('chat-toggle-btn');
    const chatWindow = document.getElementById('chat-window');
    const chatNotificationBadge = document.getElementById('chat-notification-badge');

    if (chatToggleButton && chatWindow) {
        chatToggleButton.addEventListener('click', () => {
            // Alterna la clase .visible que controla la animación CSS
            chatWindow.classList.toggle('visible');

            // Si la placa de notificación existe Y ESTAMOS ABRIENDO EL CHAT...
            if (chatNotificationBadge && chatWindow.classList.contains('visible')) {
                // ▼▼▼ MODIFICA ESTE BLOQUE ▼▼▼
                // 1. Oculta la notificación
                chatNotificationBadge.style.display = 'none';
                // 2. Resetea el contador
                unreadMessageCount = 0;
                // 3. Limpia el texto (para la próxima vez)
                chatNotificationBadge.textContent = '';
                // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲
            }
        });
    }
    // ▲▲▲ FIN DE LOS LISTENERS AÑADIDOS ▲▲▲

    // 5. Funciones de Chat (sin cambios)
    function sendChatMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        
        if (text) {
            // Encontrar nuestro nombre en el estado del juego
            const mySeat = gameState?.seats.find(s => s && s.playerId === myPlayerId);
            const senderName = mySeat ? mySeat.playerName : 'Jugador';
            
            socket.emit('sendLudoGameChat', {
                roomId: roomId,
                text: text,
                sender: senderName
            });
            input.value = '';
        }
    }
    
    function addChatMessage(sender, text) {
        // ▼▼▼ REEMPLAZA EL BLOQUE ANTERIOR CON ESTE ▼▼▼
        const chatWindow = document.getElementById('chat-window');
        const chatNotificationBadge = document.getElementById('chat-notification-badge');

        // Si la ventana NO está visible Y el badge existe...
        if (chatWindow && !chatWindow.classList.contains('visible') && chatNotificationBadge) {
            // 1. Incrementa el contador
            unreadMessageCount++;
            // 2. Muestra el contador en el badge
            chatNotificationBadge.textContent = unreadMessageCount;
            // 3. Asegúrate de que el badge esté visible
            chatNotificationBadge.style.display = 'flex'; 
        }
        // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲

        const chatMessagesInner = document.getElementById('chat-messages-inner');
        const li = document.createElement('li');
        
        const senderSpan = document.createElement('span');
        senderSpan.className = 'sender';
        senderSpan.textContent = `${sender}:`;
        
        const textNode = document.createTextNode(` ${text}`);
        
        li.appendChild(senderSpan);
        li.appendChild(textNode);
        
        chatMessagesInner.appendChild(li); // Añade al final
        
        // Auto-scroll
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.scrollTop = 0; // Mover al fondo (ya que está en flex-direction: column-reverse)
    }
    
    // ▼▼▼ FUNCIONES Y EVENTOS DE REVANCHA ▼▼▼
    
    // Función global para volver al lobby
    window.goBackToLobby = function() {
        // ▼▼▼ CRÍTICO: Emitir leaveGame antes de redirigir para liberar el asiento correctamente ▼▼▼
        if (gameState && gameState.roomId) {
            console.log('[goBackToLobby] Emitiendo leaveGame para liberar asiento en sala:', gameState.roomId);
            socket.emit('leaveGame', { roomId: gameState.roomId });
        }
        // Pequeño delay para asegurar que el servidor procese el leaveGame antes de redirigir
        setTimeout(() => {
            window.location.href = '/ludo';
        }, 100);
        // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    };
    
    // Función para configurar la pantalla de revancha
    function setupRematchScreen() {
        const victoryOverlay = document.getElementById('victory-overlay');
        const readyOverlay = document.getElementById('ready-overlay');
        const welcomeMsg = document.getElementById('welcome-message');
        const mainButton = document.getElementById('btn-ready-main');
        const spectatorButton = document.getElementById('btn-spectator-sit');
        const rematchStatusEl = document.getElementById('rematch-status');
        const betInfo = document.getElementById('bet-info');
        
        // Ocultar modal de victoria
        if (victoryOverlay) {
            victoryOverlay.classList.add('hidden');
            victoryOverlay.style.display = 'none';
        }
        
        // Configurar modal de revancha
        if (readyOverlay) {
            welcomeMsg.textContent = 'Sala de Revancha';
            
            if (gameState && gameState.settings) {
                betInfo.textContent = `Apuesta: ${gameState.settings.bet} ${gameState.settings.betCurrency || 'USD'}`;
            }
            
            rematchStatusEl.innerHTML = '<p>Esperando confirmación de los jugadores...</p>';
            
            // Mostrar botón principal para confirmar revancha
            mainButton.style.display = 'block';
            mainButton.textContent = 'Confirmar Revancha';
            mainButton.disabled = false;
            mainButton.onclick = () => {
                mainButton.disabled = true;
                mainButton.textContent = 'Esperando a los demás...';
                console.log(`[REMATCH CLIENT] -> Emitiendo 'confirmRematch' para sala ID: ${roomId}`);
                socket.emit('confirmRematch', { roomId: roomId });
            };
            
            spectatorButton.style.display = 'none';
            
            // Mostrar modal
            readyOverlay.classList.remove('hidden');
            readyOverlay.style.display = 'flex';
        }
    }
    
    // ▼▼▼ AÑADE ESTA NUEVA FUNCIÓN JUSTO ANTES DE ESE LISTENER ▼▼▼

    /**
     * Actualiza la UI del modal de revancha con los datos más recientes.
     * @param {object} data - El objeto rematchData (winnerName, confirmedPlayers, canStart, totalPlayers)
     */
    function updateRematchUI(data) {
        console.log('[REMATCH CLIENT] Actualizando UI de revancha:', data);
        
        const statusEl = document.getElementById('rematch-status');
        const startButton = document.getElementById('btn-start-rematch');
        const mainButton = document.getElementById('btn-ready-main');
        
        if (statusEl) {
            let statusHTML = '<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555;">';
            statusHTML += `<strong>Jugadores listos (${data.confirmedPlayers.length}/${data.totalPlayers}):</strong><br>`;
            
            data.confirmedPlayers.forEach(player => {
                statusHTML += `✅ ${player}<br>`;
            });
            
            // Mostrar jugadores pendientes
            const remainingPlayers = data.totalPlayers - data.confirmedPlayers.length;
            if (remainingPlayers > 0) {
                statusHTML += `<span style="color: #888;">⏳ Esperando ${remainingPlayers} jugador(es) más...</span><br>`;
            }
            
            statusHTML += '</div>';
            statusEl.innerHTML = statusHTML;
        }

        // Mostrar botón de iniciar solo al ganador anterior
        if (startButton) {
            let currentUsername = null;
            if (gameState && gameState.seats && gameState.mySeatIndex !== undefined && gameState.mySeatIndex >= 0) {
                const mySeat = gameState.seats[gameState.mySeatIndex];
                if (mySeat) {
                    currentUsername = mySeat.playerName;
                }
            }
            const isWinner = data.winnerName && currentUsername === data.winnerName;
            
            console.log(`[REMATCH IS_WINNER CHECK]`);
            console.log(`  - currentUsername (cliente): '${currentUsername}'`);
            console.log(`  - data.winnerName (servidor): '${data.winnerName}'`);
            console.log(`  - Comparación (===): ${currentUsername === data.winnerName}`);
            console.log(`  - data.canStart (servidor): ${data.canStart}`);
            console.log(`  - Resultado final (data.canStart && isWinner): ${data.canStart && isWinner}`);
            console.log(`[REMATCH BUTTON CHECK] Can Start: ${data.canStart}, Is Winner (${currentUsername} vs ${data.winnerName}): ${isWinner}`);
            
            if (data.canStart && isWinner) {
                startButton.style.display = 'block';
                startButton.textContent = `🎮 Iniciar Nueva Partida`;
                startButton.disabled = false; // Habilita el botón
                
                if (mainButton) mainButton.style.display = 'none'; // Oculta el botón "Confirmar/Esperando"
                
                startButton.onclick = () => {
                    startButton.disabled = true;
                    socket.emit('startRematch', { roomId: gameState.roomId });
                };
            } else {
                startButton.style.display = 'none';

                // (Aseguramos que 'currentUsername' esté definido)
                if (!currentUsername) {
                    console.error("[REMATCH CHECK] No se pudo obtener el nombre de usuario local desde gameState.");
                }
                
                // Comprobar si el usuario actual ya está en la lista de confirmados
                const isAlreadyConfirmed = currentUsername && data.confirmedPlayers.includes(currentUsername);

                if (mainButton) {
                    if (isAlreadyConfirmed) {
                        // Ya estoy confirmado (porque me acabo de unir), mostrar "Esperando..."
                        mainButton.style.display = 'block';
                        mainButton.textContent = 'Esperando a los demás...';
                        mainButton.disabled = true;
                    } else {
                        // No estoy confirmado (soy un jugador de la partida anterior)
                        // Dejamos el botón como lo puso 'setupRematchScreen' ("Confirmar Revancha")
                        mainButton.style.display = 'block';
                        mainButton.textContent = 'Confirmar Revancha';
                        mainButton.disabled = false;
                    }
                }
            }
        }
    }
    // ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲

    // Event listener para actualización de estado de revancha
    // ▼▼▼ MODIFICA ESTE LISTENER PARA QUE USE LA NUEVA FUNCIÓN ▼▼▼
    socket.on('rematchUpdate', (data) => {
        console.log('[REMATCH CLIENT] Recibido socket rematchUpdate:', data);
        updateRematchUI(data); // Llama a la nueva función
    });
    // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲
    
    // ▼▼▼ ¡AÑADE ESTE LISTENER COMPLETO! ▼▼▼
    socket.on('ludoResetBoard', () => {
        console.log("🧹 Recibido ludoResetBoard. Limpiando tablero visualmente...");

        // 1. Limpiar fichas activas
        document.querySelectorAll('.ludo-piece.active').forEach(p => p.remove());

        // 2. Limpiar fichas en base (contenedores)
        document.querySelectorAll('.base-pieces-container').forEach(c => c.innerHTML = '');

        // 3. Limpiar dados (resetear rotación y quitar valores si los hubiera)
        const allDiceIds = [
            'player-dice-yellow-1', 'player-dice-yellow-2',
            'player-dice-green-1', 'player-dice-green-2',
            'player-dice-red-1', 'player-dice-red-2',
            'player-dice-blue-1', 'player-dice-blue-2'
        ];
        allDiceIds.forEach(diceId => {
            const diceElement = document.getElementById(diceId);
            if (diceElement) {
                diceElement.style.transition = 'none';
                diceElement.style.transform = 'rotateX(0deg) rotateY(0deg)';
                delete diceElement.dataset.value;
            }
        });

        // 4. Quitar brillo de turno
        document.querySelectorAll('.player-info-box.current-turn-glow').forEach(el => {
            el.classList.remove('current-turn-glow');
        });

        // 5. Limpiar popups si existen
        document.querySelectorAll('.dice-choice-popup').forEach(p => p.remove());

        // 6. Limpiar resaltados de falta si existen
        document.querySelectorAll('.penalty-highlight-lime, .penalty-highlight-orange, .target-piece-highlight-green, .target-kill-highlight, .killing-piece-highlight, .cell.target-kill-highlight, .cell.killing-piece-highlight').forEach(el => {
            el.classList.remove('penalty-highlight-lime', 'penalty-highlight-orange', 'target-piece-highlight-green', 'target-kill-highlight', 'killing-piece-highlight');
            el.style.animation = '';
            el.style.outline = '';
            el.style.boxShadow = '';
            el.style.stroke = '';
            el.style.strokeWidth = '';
            el.style.backgroundColor = '';
        });

        // 7. Opcional: Resetear texto del bote (si no se actualiza bien después)
        // const potEl = document.getElementById('game-pot');
        // if (potEl) potEl.textContent = '0';
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // Event listener para cuando inicia la revancha
    socket.on('rematchStarted', (data) => {
        console.log('🏁 Revancha iniciada por el servidor:', data);
        const readyOverlay = document.getElementById('ready-overlay');

        // Ocultar modal de revancha
        if (readyOverlay) {
            readyOverlay.classList.add('hidden');
            readyOverlay.style.display = 'none';
        }

        // ▼▼▼ INICIO: RE-RENDER COMPLETO ▼▼▼

        // 1. Actualizar estado local COMPLETO
        gameState.gameState = data.gameState;
        gameState.seats = data.seats;
        gameState.state = 'playing'; // La revancha empieza jugando

        // ▼▼▼ ¡CORRECCIÓN AÑADIDA! ▼▼▼
        // Antes de renderizar, debemos encontrar nuestro NUEVO índice de asiento,
        // ya que la re-asignación diagonal de la revancha pudo habernos movido.
        const myUserId = sessionStorage.getItem('userId');
        const newMySeatIndex = gameState.seats.findIndex(s => s && s.userId === myUserId);
        
        if (newMySeatIndex !== -1 && newMySeatIndex !== gameState.mySeatIndex) {
             console.warn(`[REMATCHA] ¡Mi asiento ha cambiado! De ${gameState.mySeatIndex} a ${newMySeatIndex}`);
             gameState.mySeatIndex = newMySeatIndex; // ¡Actualiza el índice!
        } else if (newMySeatIndex !== -1) {
             console.log(`[REMATCHA] Mi asiento (${gameState.mySeatIndex}) no ha cambiado.`);
        } else {
             console.warn(`[REMATCHA] No me pude encontrar (${myUserId}) en los nuevos asientos. Asignando -1.`);
             gameState.mySeatIndex = -1; // Fallback para espectador
        }
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

        // 2. Re-renderizar TODO el tablero y la UI DESPUÉS de un pequeño delay
        //    (para asegurar que ludoResetBoard termine la limpieza visual)
        setTimeout(() => {
            function attemptFullRender() {
                if (window.ludoBoardGenerated) {
                    // ESTA LÍNEA AHORA USA EL mySeatIndex ACTUALIZADO
                    console.log(`   - Renderizando tablero (con nuevo índice ${gameState.mySeatIndex})...`);
                    renderLudoBoard(gameState); // Renderiza layout y cajas de info
                    console.log("   - Renderizando fichas base...");
                    renderBasePieces(gameState.gameState.pieces); // Dibuja fichas en base
                    console.log("   - Renderizando fichas activas...");
                    renderActivePieces(gameState.gameState.pieces); // Dibuja fichas en tablero
                    console.log("   - Actualizando UI de turno (dados)...");
                    updateTurnUI(); // Habilita/deshabilita dados según el turno inicial
                    console.log("   - Actualizando brillo de turno...");
                    updateTurnGlow(gameState.gameState.turn.playerIndex); // Pone el brillo en el jugador inicial

                    // Actualizar el bote
                    const potEl = document.getElementById('game-pot');
                     if (potEl && gameState.gameState.pot !== undefined) {
                          potEl.textContent = `${gameState.gameState.pot} ${gameState.settings.betCurrency || 'USD'}`;
                     }
                     console.log('✅ Re-renderizado completo para revancha.');

                } else {
                    console.warn('El tablero aún no se ha generado para la revancha, esperando 100ms...');
                    setTimeout(attemptFullRender, 100);
                }
            }
            attemptFullRender();
        }, 50); // Pequeño delay de 50ms

        // ▲▲▲ FIN: RE-RENDER COMPLETO ▲▲▲
    });
    
    // ▲▲▲ FIN FUNCIONES Y EVENTOS DE REVANCHA ▲▲▲
    
    // ▼▼▼ AÑADIR ESTA NUEVA FUNCIÓN COMPLETA ▼▼▼
    /**
     * Muestra u oculta las etiquetas de pareja (A/B)
     * @param {object} state - El estado completo del juego (gameState).
     */
    function updatePairLabels(state) {
        document.querySelectorAll('.pair-label').forEach(label => {
            label.style.display = 'none';
            label.classList.remove('pair-A', 'pair-B');
            label.textContent = '';
        });

        const gameType = state?.settings?.gameType;
        const parchisMode = state?.settings?.parchisMode;

        if (gameType !== 'parchis' || parchisMode !== '4-groups') {
            return;
        }

        console.log("[Parchís] Modo '4-groups' detectado. Mostrando etiquetas de pareja A y B.");

        const pairA_Colors = ['red', 'yellow'];
        const pairB_Colors = ['blue', 'green'];

        pairA_Colors.forEach(color => {
            const label = document.getElementById(`pair-label-${color}`);
            if (label) {
                label.textContent = 'A';
                label.classList.add('pair-A');
                label.style.display = 'flex';
            }
        });

        pairB_Colors.forEach(color => {
            const label = document.getElementById(`pair-label-${color}`);
            if (label) {
                label.textContent = 'B';
                label.classList.add('pair-B');
                label.style.display = 'flex';
            }
        });
    }
    // ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲
    
    // Inicialización
    console.log('Cliente de Ludo iniciado. Sala:', roomId);
    
    // ▼▼▼ LÓGICA AÑADIDA PARA BOTONES "X" DE CERRAR MODAL ▼▼▼
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => {
            // Busca el modal padre más cercano y lo oculta
            const modal = btn.closest('.overlay, [role="dialog"]');
            if (modal) {
                // Casos especiales de ludo.html
                if (modal.id === 'victory-overlay' || modal.id === 'ready-overlay') {
                    // No hacer nada o redirigir al lobby, pero por ahora solo ocultamos
                    modal.style.display = 'none';
                } else {
                    modal.style.display = 'none';
                }
            }
        };
    });
    // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲
    
    // ▼▼▼ CÓDIGO DEL BOTÓN DE SILENCIAR SONIDOS ▼▼▼
    /**
     * Cambia el estado de silencio, actualiza el icono y guarda la preferencia.
     */
    function toggleMute() {
        const newMutedState = !getIsMuted();
        localStorage.setItem('la51_sound_muted', newMutedState);
        updateSoundButtonUI();
    }

    /**
     * Actualiza la apariencia del botón según el estado de silenciado.
     */
    function updateSoundButtonUI() {
        const soundButton = document.getElementById('btn-toggle-sound');
        if (soundButton) {
            const isMuted = getIsMuted();
            if (isMuted) {
                soundButton.textContent = '🔇'; // Icono de silenciado
                soundButton.title = 'Activar Sonidos';
                soundButton.classList.add('muted');
            } else {
                soundButton.textContent = '🔊'; // Icono de sonido activo
                soundButton.title = 'Silenciar Sonidos';
                soundButton.classList.remove('muted');
            }
        }
    }

    // Inicializar el botón cuando la página carga
    const soundButton = document.getElementById('btn-toggle-sound');
    if (soundButton) {
        // 1. Actualizar el botón para que refleje el estado inicial (lee de localStorage)
        updateSoundButtonUI();

        // 2. Asignar la función de 'toggle' al clic del botón
        soundButton.addEventListener('click', toggleMute);
    }
    // ▲▲▲ FIN DEL CÓDIGO DEL BOTÓN DE SILENCIAR SONIDOS ▲▲▲
    
});
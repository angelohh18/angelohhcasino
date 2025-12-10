// game.js (Archivo completo y actualizado)

/**
 * Convierte una cantidad de una moneda a otra usando las tasas de cambio.
 * @param {number} amount - La cantidad a convertir.
 * @param {string} fromCurrency - La moneda de origen (ej. 'USD').
 * @param {string} toCurrency - La moneda de destino (ej. 'EUR').
 * @param {object} rates - El objeto de tasas de cambio (clientExchangeRates).
 * @returns {number} - La cantidad convertida.
 */
function convertCurrency(amount, fromCurrency, toCurrency, rates) {
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
        return amount;
    }
    if (rates[fromCurrency] && rates[fromCurrency][toCurrency]) {
        return amount * rates[fromCurrency][toCurrency];
    }
    if (rates[toCurrency] && rates[toCurrency][fromCurrency]) {
         return amount / rates[toCurrency][fromCurrency];
    }
    console.warn(`No se encontró tasa de cambio entre ${fromCurrency} y ${toCurrency}.`);
    return amount; 
}

// ▼▼▼ REEMPLAZA TU FUNCIÓN playSound CON ESTA VERSIÓN REFORZADA ▼▼▼
function playSound(soundId) {
    // 1. Si está silenciado, no hace nada.
    if (isMuted) return;

    try {
        // 2. Buscamos el elemento de audio ORIGINAL.
        const soundElement = document.getElementById(`sound-${soundId}`);
        
        if (soundElement) {
            
            // --- INICIO DEL REFUERZO (Pausa explícita) ---

            // 3. (REFUERZO) Hacemos una pausa explícita primero.
            // Esto "limpia" cualquier reproducción anterior y evita
            // la condición de carrera si el sonido se llama dos veces rápido.
            soundElement.pause();
            
            // 4. FORZAMOS el reinicio del sonido.
            soundElement.currentTime = 0;
            
            // 5. Reproducimos el sonido.
            const playPromise = soundElement.play();
            
            // 6. MANTENEMOS la captura de errores.
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn(`[Audio] No se pudo reproducir '${soundId}' (Error esperado en iOS):`, error.name);
                });
            }
            // --- FIN DEL REFUERZO ---
        }
    } catch (error) {
        console.warn(`No se pudo reproducir el sonido: ${soundId}`, error);
    }
}
// ▲▲▲ FIN DE LA FUNCIÓN A REEMPLAZAR ▲▲▲

// SOLUCIÓN AL ERROR: El error muestra "convertcurrency" en minúsculas, 
// lo que probablemente es una errata en alguna parte del código. 
// Para solucionarlo de forma segura, creamos un alias que apunta a la función correcta.
const convertcurrency = convertCurrency;


// Nueva función simple para mostrar el modal de fondos insuficientes
function showInsufficientFundsModal(requiredText, missingText) {
    const modal = document.getElementById('simple-funds-modal');
    const messageEl = document.getElementById('simple-funds-message');
    const closeBtn = document.getElementById('simple-funds-close-btn');

    if (!modal || !messageEl || !closeBtn) {
        console.error("No se encontraron los elementos del nuevo modal de fondos.");
        alert(`Fondos Insuficientes:\nNecesitas: ${requiredText}\nTe faltan: ${missingText}`);
        return;
    }

    messageEl.innerHTML = `Necesitas <strong>${requiredText}</strong> para unirte.<br>Te faltan <strong style="color: #ff4444;">${missingText}</strong>.`;

    closeBtn.textContent = 'Aceptar'; // Aseguramos el texto por defecto
    closeBtn.onclick = () => { modal.style.display = 'none'; };
    modal.style.display = 'flex';
}

function showRematchFundsModal(requiredText, missingText) {
    const modal = document.getElementById('simple-funds-modal');
    const messageEl = document.getElementById('simple-funds-message');
    const actionBtn = document.getElementById('simple-funds-close-btn');

    if (!modal || !messageEl || !actionBtn) return;

    messageEl.innerHTML = `No tienes fondos suficientes para la revancha.<br>Necesitas <strong>${requiredText}</strong>.<br>Te faltan <strong style="color: #ff4444;">${missingText}</strong>.`;

    // Cambiamos el texto y la acción del botón
    actionBtn.textContent = 'Volver al Lobby';
    actionBtn.onclick = () => {
        modal.style.display = 'none';
        goBackToLobby(); // Esta función ya se encarga de sacar al jugador de la mesa
    };

    modal.style.display = 'flex';
}

// --- INICIO: SCRIPT DE PUENTE (BRIDGE) ---

// ▼▼▼ PEGA LA FUNCIÓN COMPLETA AQUÍ ▼▼▼
function showToast(msg, duration = 3000, isFirstTurn = false) {
    console.log('[showToast] Llamada con mensaje:', msg, 'duración:', duration, 'isFirstTurn:', isFirstTurn);
    const toast = document.getElementById('toast');
    if (!toast) {
        console.error("[showToast] ❌ Elemento 'toast' no encontrado en el DOM.");
        return;
    }
    console.log('[showToast] ✅ Elemento toast encontrado:', toast);
    toast.textContent = msg;
    console.log('[showToast] Texto asignado al toast');
    
    // Si es el mensaje del primer turno, agregar la clase especial para centrarlo
    if (isFirstTurn) {
        toast.classList.add('first-turn');
        // Asegurar que se mantenga centrado con estilos inline
        toast.style.top = '50%';
        toast.style.bottom = 'auto';
        toast.style.transform = 'translate(-50%, -50%)';
    } else {
        toast.classList.remove('first-turn');
        // Restaurar estilos por defecto
        toast.style.top = 'auto';
        toast.style.bottom = '26px';
        toast.style.transform = 'translateX(-50%)';
    }
    
    // Forzar visibilidad antes de agregar la clase
    toast.style.display = 'block';
    toast.style.visibility = 'visible';
    toast.style.opacity = '1';
    
    toast.classList.add('show');
    console.log('[showToast] Clase "show" agregada. Estado del toast:', {
        display: toast.style.display,
        visibility: toast.style.visibility,
        opacity: toast.style.opacity,
        classList: Array.from(toast.classList),
        textContent: toast.textContent
    });
    
    // Usamos un temporizador para ocultar el toast después de la duración
    // Si es el primer turno, se ocultará automáticamente después de 10 segundos (manejado en firstTurnInfo)
    // Si NO es el primer turno, se oculta después de la duración especificada
    if (!isFirstTurn) {
        setTimeout(() => {
            toast.classList.remove('show');
            toast.style.display = 'none';
            toast.style.opacity = '0';
            toast.style.visibility = 'hidden';
            console.log('[showToast] Clase "show" removida después de', duration, 'ms');
        }, duration);
    }
    // Nota: El primer turno se oculta automáticamente después de 10 segundos en el listener firstTurnInfo
}
// ▲▲▲ FIN DEL CÓDIGO A PEGAR ▲▲▲

function showLobbyView() {
    document.body.classList.remove('game-active'); // >> AÑADE ESTA LÍNEA <<
    document.getElementById('lobby-overlay').style.display = 'flex';
    document.getElementById('game-container').style.display = 'none';
    hideOverlay('ready-overlay'); // Asegurarse que el overlay se oculte al volver
    if (typeof scaleAndCenterLobby === 'function') {
        scaleAndCenterLobby();
    }
    if (typeof updateLobbyCreditsDisplay === 'function') {
        updateLobbyCreditsDisplay();
    }
}

function showGameView(settings) {
    document.body.classList.add('game-active'); // >> AÑADE ESTA LÍNEA <<
    document.getElementById('lobby-overlay').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // ▼▼▼ CRÍTICO: Guardar roomId en sessionStorage para reconexión automática ▼▼▼
    if (settings && settings.roomId && !settings.isPractice) {
        sessionStorage.setItem('la51RoomId', settings.roomId);
        console.log(`[showGameView] Guardado roomId en sessionStorage: ${settings.roomId}`);
    }
    // ▲▲▲ FIN GUARDAR ROOMID ▲▲▲
    
    if (typeof initializeGame === 'function') {
        initializeGame(settings);
    }
}
// --- FIN: SCRIPT DE PUENTE (BRIDGE) ---

// ▼▼▼ PEGA LAS FUNCIONES AQUÍ ▼▼▼
function showOverlay(id) {
    const overlay = document.getElementById(id);
    if (overlay) overlay.style.display = 'flex';
}

function hideOverlay(id) {
    const overlay = document.getElementById(id);
    if (overlay) overlay.style.display = 'none';
}

// ▼▼▼ NUEVAS FUNCIONES DE AYUDA PARA EL MODAL DE FUNCIONES ▼▼▼
function showFunctionsModal() {
    showOverlay('functions-modal');
}
function hideFunctionsModal() {
    hideOverlay('functions-modal');
}
// ▼▼▼ FUNCIÓN showFunctionsModalOnce CON SEGURIDAD ▼▼▼
function showFunctionsModalOnce() {
    // LÍNEA DE SEGURIDAD: Si el usuario no ha iniciado sesión, esta función no hace nada.
    if (!document.body.classList.contains('is-logged-in')) {
        return;
    }

    // El resto de la lógica se mantiene igual
    if (localStorage.getItem('la51_functions_modal_shown') !== 'true') {
        showFunctionsModal();
        localStorage.setItem('la51_functions_modal_shown', 'true');
    }
}

// ▼▼▼ NUEVAS FUNCIONES PARA EL MODAL DE INFORMACIÓN DE BOTS ▼▼▼
function showBotInfoModal() {
    showOverlay('bot-info-modal');
}
function hideBotInfoModal() {
    hideOverlay('bot-info-modal');
}
function showBotInfoModalOnce() {
    if (localStorage.getItem('la51_bot_info_shown') !== 'true') {
        showBotInfoModal();
        localStorage.setItem('la51_bot_info_shown', 'true');
    }
}
// ▲▲▲ FIN DE LAS NUEVAS FUNCIONES ▲▲▲
// ▲▲▲ FIN DEL CÓDIGO A PEGAR ▲▲▲

const socket = io(window.location.origin, { 
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    timeout: 20000,
    transports: ['websocket', 'polling']
});

let spectatorMode = 'wantsToPlay'; // Variable global para controlar el modo espectador
let clientExchangeRates = {}; // Para guardar las tasas
let lastKnownRooms = []; // <-- AÑADE ESTA LÍNEA
let shouldRedirectToLobbyAfterElimination = false; // Variable global para rastrear si debe redirigir al lobby después de cerrar el modal de eliminación
let eliminationGameType = null; // Variable global para guardar el tipo de juego (la51, ludo, parchis) cuando el jugador es eliminado
let currentGameSettings = null; // ▼▼▼ CRÍTICO: Declarar currentGameSettings como variable global para evitar ReferenceError ▼▼▼
let welcomeModalShownForRoom = null; // ▼▼▼ CRÍTICO: Rastrear si el modal de bienvenida ya se mostró para esta sala ▼▼▼

// Variables globales para el estado del usuario (migración segura)
let currentUser = {
    username: '',
    userAvatar: '',
    userId: '',
    credits: 1000
};

socket.on('connect', () => {
    console.log('🔌 Conexión global con el servidor establecida. ID:', socket.id);
    socket.emit('requestInitialData'); // Un nuevo evento que crearemos en el servidor
    
    // ▼▼▼ CRÍTICO: Reconexión automática si estaba en una partida activa ▼▼▼
    // Usar sessionStorage primero, luego currentGameSettings si está disponible
    const savedRoomId = sessionStorage.getItem('la51RoomId') || (typeof currentGameSettings !== 'undefined' && currentGameSettings && currentGameSettings.roomId ? currentGameSettings.roomId : null);
    if (savedRoomId && savedRoomId !== `practice-${socket.id}`) {
        const username = sessionStorage.getItem('username') || localStorage.getItem('username');
        if (username) {
            const user = {
                username: username,
                avatar: sessionStorage.getItem('avatar') || localStorage.getItem('avatar') || '',
                credits: parseFloat(sessionStorage.getItem('userCredits') || localStorage.getItem('userCredits') || 1000),
                currency: sessionStorage.getItem('userCurrency') || localStorage.getItem('userCurrency') || 'USD'
            };
            console.log(`[RECONNECT] Reconectando automáticamente a sala ${savedRoomId}...`);
            socket.emit('joinRoom', { roomId: savedRoomId, user: user });
        }
    }
    // ▲▲▲ FIN RECONEXIÓN AUTOMÁTICA ▲▲▲
});

socket.on('connect_error', (error) => {
    console.warn('⚠️ Error de conexión con el servidor:', error.message);
    // No mostrar errores 503 al usuario, solo loguear
    if (error.message && !error.message.includes('503')) {
        console.error('Error de conexión:', error);
    }
});

socket.on('disconnect', (reason) => {
    console.log('🔌 [CLIENTE] Desconectado del servidor. Razón:', reason);
    console.log('🔌 [CLIENTE DEBUG] Stack trace de desconexión:', new Error().stack);
    console.log('🔌 [CLIENTE DEBUG] currentGameSettings:', currentGameSettings);
    console.log('🔌 [CLIENTE DEBUG] socket.connected antes:', socket.connected);
    // No intentar reconectar si es un error del servidor
    if (reason === 'io server disconnect' || reason === 'transport close') {
        console.warn('⚠️ El servidor cerró la conexión. No se intentará reconectar automáticamente.');
    }
});

// ▼▼▼ CRÍTICO: Reconexión automática cuando la página vuelve a estar visible ▼▼▼
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && socket.connected) {
        const savedRoomId = sessionStorage.getItem('la51RoomId') || (typeof currentGameSettings !== 'undefined' && currentGameSettings && currentGameSettings.roomId ? currentGameSettings.roomId : null);
        if (savedRoomId && savedRoomId !== `practice-${socket.id}`) {
            const username = sessionStorage.getItem('username') || localStorage.getItem('username');
            if (username) {
                const user = {
                    username: username,
                    avatar: sessionStorage.getItem('avatar') || localStorage.getItem('avatar') || '',
                    credits: parseFloat(sessionStorage.getItem('userCredits') || localStorage.getItem('userCredits') || 1000),
                    currency: sessionStorage.getItem('userCurrency') || localStorage.getItem('userCurrency') || 'USD'
                };
                console.log(`[RECONNECT] Página visible - reconectando automáticamente a sala ${savedRoomId}...`);
                socket.emit('joinRoom', { roomId: savedRoomId, user: user });
            }
        }
    }
});

window.addEventListener('focus', () => {
    if (socket.connected) {
        const savedRoomId = sessionStorage.getItem('la51RoomId') || (typeof currentGameSettings !== 'undefined' && currentGameSettings && currentGameSettings.roomId ? currentGameSettings.roomId : null);
        if (savedRoomId && savedRoomId !== `practice-${socket.id}`) {
            const username = sessionStorage.getItem('username') || localStorage.getItem('username');
            if (username) {
                const user = {
                    username: username,
                    avatar: sessionStorage.getItem('avatar') || localStorage.getItem('avatar') || '',
                    credits: parseFloat(sessionStorage.getItem('userCredits') || localStorage.getItem('userCredits') || 1000),
                    currency: sessionStorage.getItem('userCurrency') || localStorage.getItem('userCurrency') || 'USD'
                };
                console.log(`[RECONNECT] Ventana enfocada - reconectando automáticamente a sala ${savedRoomId}...`);
                socket.emit('joinRoom', { roomId: savedRoomId, user: user });
            }
        }
    }
});
// ▲▲▲ FIN RECONEXIÓN AUTOMÁTICA ▲▲▲


// ▼▼▼ FUNCIÓN PWA INSTALL MODAL (GLOBAL) ▼▼▼
function showPwaInstallModal() {
    // 1. Comprueba si ya se mostró en esta sesión.
    if (sessionStorage.getItem('pwaModalShown')) {
        return;
    }

    // 2. Detecta si el usuario está en un dispositivo móvil.
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
        const modal = document.getElementById('pwa-install-modal');
        const closeBtn = document.getElementById('btn-close-pwa-modal');
        const installBtn = document.getElementById('btn-install-pwa');

        if (modal && closeBtn) {
            // 3. Muestra el modal.
            modal.style.display = 'flex';

            // 4. Si la app es instalable (deferredPrompt existe), muestra el botón de instalar.
            if (installBtn && window.deferredPrompt) {
                installBtn.style.display = 'block';

                installBtn.onclick = async () => {
                    // Muestra el prompt de instalación nativo.
                    window.deferredPrompt.prompt();

                    // Espera a que el usuario responda.
                    const { outcome } = await window.deferredPrompt.userChoice;
                    console.log(`Respuesta del usuario al prompt de instalación: ${outcome}`);

                    // Limpiamos el prompt, ya que solo se puede usar una vez.
                    window.deferredPrompt = null;

                    // Ocultamos el modal y el botón de instalar después de la acción.
                    modal.style.display = 'none';
                };
            }

            // 5. El botón "Aceptar" simplemente cierra el modal.
            closeBtn.onclick = () => {
                modal.style.display = 'none';
            };

            // 6. Guarda una bandera para que no vuelva a aparecer en esta sesión.
            sessionStorage.setItem('pwaModalShown', 'true');
        }
    }
}
// ▲▲▲ FIN DE LA FUNCIÓN PWA INSTALL MODAL ▲▲▲

// --- INICIO: SCRIPT DEL LOBBY ---
(function(){
    // ▼▼▼ REGISTRAR LISTENER PRIMERO (ANTES DE CUALQUIER EMISIÓN) ▼▼▼
    // ▼▼▼ FUNCIÓN PARA RENDERIZAR LISTA DE JUGADORES ▼▼▼
    function renderOnlineUsers(userList = []) {
        console.log('[Cliente] renderOnlineUsers llamado con', userList?.length || 0, 'usuarios');
        const listElement = document.getElementById('online-users-list');
        if (!listElement) {
            console.error('[Cliente] ERROR: Elemento online-users-list no encontrado en el DOM');
            return;
        }

        listElement.innerHTML = ''; // Limpia la lista actual

        if (!userList || userList.length === 0) {
            console.log('[Cliente] Lista de usuarios vacía, no hay nada que renderizar');
            return;
        }

        // Ordena la lista alfabéticamente por nombre de usuario
        userList.sort((a, b) => a.username.localeCompare(b.username));

        userList.forEach(user => {
            const li = document.createElement('li');
            // ▼▼▼ Determinar la clase CSS: naranja para "Jugando", "En mesa de Ludo" o "En mesa de La 51" ▼▼▼
            const statusText = user.status || 'En el Lobby';
            const isPlaying = statusText.includes('Jugando') || statusText.includes('En partida');
            const isInTable = statusText.includes('En mesa de');
            const statusClass = (isPlaying || isInTable) ? 'status-playing' : 'status-lobby';
            // ▲▲▲ FIN DETERMINACIÓN DE CLASE CSS ▲▲▲
            
            li.innerHTML = `
                <span>${user.username}</span>
                <span class="user-status ${statusClass}" title="${statusText}">${statusText}</span>
            `;
            listElement.appendChild(li);
        });
        
        console.log('[Cliente] Lista de usuarios renderizada correctamente:', userList.length, 'usuarios');
    }
    // ▲▲▲ FIN: FUNCIÓN AÑADIDA ▲▲▲

    // ▼▼▼ LISTENER PARA ACTUALIZAR LISTA DE USUARIOS (REGISTRAR PRIMERO) ▼▼▼
    socket.on('updateUserList', (userList) => {
        console.log('[Cliente] ✅ Recibida lista de usuarios:', userList?.length || 0, 'usuarios');
        renderOnlineUsers(userList);
    });
    // ▲▲▲ FIN: LISTENER AÑADIDO ▲▲▲
    // ▲▲▲ FIN: REGISTRAR LISTENER PRIMERO ▲▲▲

    // Notificar al servidor que estamos en el lobby de La 51
    if (socket.connected) {
        console.log('[Cliente] Socket ya conectado, emitiendo enterLa51Lobby');
        socket.emit('enterLa51Lobby');
    } else {
        console.log('[Cliente] Socket no conectado, esperando conexión...');
        socket.on('connect', () => {
            console.log('[Cliente] Socket conectado, emitiendo enterLa51Lobby');
            socket.emit('enterLa51Lobby');
        });
    }

    socket.on('updateRoomList', (serverRooms) => {
        lastKnownRooms = serverRooms || [];
        renderRoomsOverview(lastKnownRooms);
    });

    socket.on('userStateUpdated', (userState) => {
        console.log('Estado de usuario actualizado:', userState);
        currentUser.credits = userState.credits;
        currentUser.currency = userState.currency;
        
        // ▼▼▼ CRÍTICO: Actualizar también username y avatar si están incluidos ▼▼▼
        if (userState.username) {
            currentUser.username = userState.username;
            sessionStorage.setItem('username', userState.username);
            localStorage.setItem('username', userState.username);
            // Actualizar el nombre en la UI
            const userNameEl = document.getElementById('user-name');
            if (userNameEl) {
                userNameEl.textContent = userState.username;
            }
        }
        if (userState.avatar) {
            currentUser.userAvatar = userState.avatar;
            sessionStorage.setItem('userAvatar', userState.avatar);
            localStorage.setItem('userAvatar', userState.avatar);
            // Actualizar el avatar en la UI
            const userAvatarEl = document.getElementById('user-avatar');
            if (userAvatarEl) {
                userAvatarEl.src = userState.avatar;
            }
        }
        // ▲▲▲ FIN DE ACTUALIZACIÓN CRÍTICA ▲▲▲

        if (typeof updateLobbyCreditsDisplay === 'function') {
            updateLobbyCreditsDisplay();
        }
        
        renderRoomsOverview(lastKnownRooms); 
    });

    // ▼▼▼ LISTENERS DEL CHAT DEL LOBBY DE LA 51 (SEPARADOS) ▼▼▼
    // Eliminar listeners anteriores para evitar duplicados
    socket.off('la51LobbyChatHistory');
    socket.off('la51LobbyChatUpdate');
    socket.off('lobbyChatHistory');
    socket.off('lobbyChatUpdate');
    
    socket.on('la51LobbyChatHistory', (history) => {
        console.log('Historial del chat del lobby de La 51 recibido.');
        renderLobbyChat(history);
    });

    socket.on('la51LobbyChatUpdate', (newMessage) => {
        addLobbyChatMessage(newMessage);
    });
    
    socket.on('la51LobbyChatCleared', () => {
        console.log('Chat del lobby de La 51 limpiado automáticamente después de 10 minutos de inactividad');
        renderLobbyChat([]); // Limpiar el chat visualmente
    });
    // ▲▲▲ FIN DE LOS LISTENERS DEL CHAT DE LA 51 ▲▲▲

    socket.on('exchangeRatesUpdate', (rates) => {
        console.log('Tasas de cambio actualizadas:', rates);
        clientExchangeRates = rates;
        renderRoomsOverview(lastKnownRooms);
    });

    socket.on('roomCreatedSuccessfully', (roomData) => {
        showGameView({ ...roomData, isPractice: false });
    });
    
    socket.on('joinedRoomSuccessfully', (roomData) => {
        // ▼▼▼ VERIFICAR SI EL JUGADOR FUE ELIMINADO ANTES DE MOSTRAR LA VISTA DEL JUEGO ▼▼▼
        // Si shouldRedirectToLobbyAfterElimination está activo, no mostrar la vista del juego
        if (shouldRedirectToLobbyAfterElimination) {
            console.log('[joinedRoomSuccessfully] Jugador fue eliminado, ignorando unión a la sala');
            return; // No mostrar la vista del juego
        }
        // ▲▲▲ FIN DE VERIFICACIÓN ▲▲▲
        
        // ▼▼▼ CRÍTICO: Asegurar que hostId esté establecido correctamente ▼▼▼
        if (roomData.hostId) {
            currentGameSettings = { ...currentGameSettings, ...roomData };
            currentGameSettings.hostId = roomData.hostId;
            console.log(`[joinedRoomSuccessfully] hostId establecido: ${roomData.hostId}, socket.id: ${socket.id}`);
        } else {
            currentGameSettings = { ...currentGameSettings, ...roomData };
            console.log(`[joinedRoomSuccessfully] ⚠️ hostId no incluido en roomData`);
        }
        // ▲▲▲ FIN ESTABLECER HOSTID ▲▲▲
        
        // ▼▼▼ CRÍTICO: Si el juego ya está en curso, NO llamar a showGameView (evita reiniciar el juego) ▼▼▼
        // Si el juego está en curso, solo actualizar el estado sin reiniciar
        if (roomData.state === 'playing' && typeof gameStarted !== 'undefined' && gameStarted) {
            console.log('[joinedRoomSuccessfully] Juego ya en curso - NO reiniciando. Solo actualizando estado.');
            // NO actualizar la vista aquí - gameStateSync se encargará de eso
            // Solo retornar para evitar que se reinicie el juego
            return; // NO llamar a showGameView - el juego ya está en curso
        }
        // ▲▲▲ FIN VERIFICACIÓN DE JUEGO EN CURSO ▲▲▲
        
        // Solo llamar a showGameView si el juego NO está en curso (nueva unión o juego en espera)
        showGameView({ ...roomData, isPractice: false });
    });

    socket.on('joinError', (message) => {
        console.error('Error al unirse a la sala:', message);
        showToast(`Error: ${message}`, 4000);
    });

    // ▼▼▼ HANDLER: Jugador eliminado por inactividad - mostrar mensaje y redirigir al lobby ▼▼▼
    // ▼▼▼ HANDLERS DUPLICADOS ELIMINADOS - SE USA playerEliminated CON redirect: true ▼▼▼
    // Estos handlers estaban causando conflictos y ya no son necesarios
    // El handler playerEliminated maneja todo correctamente con el flag redirect
    // ▲▲▲ FIN DE ELIMINACIÓN DE HANDLERS DUPLICADOS ▲▲▲

    // ▼▼▼ AÑADE ESTE LISTENER COMPLETO ▼▼▼
    socket.on('potUpdated', (data) => {
        const potContainer = document.getElementById('game-pot-container');
        if (!potContainer) return;

        const potValueEl = potContainer.querySelector('.pot-value');
        if (!potValueEl) return;

        potValueEl.textContent = data.newPotValue;

        // Aplicamos la nueva animación de pulso al valor numérico
        if (data.isPenalty) {
            potValueEl.classList.add('pot-updated');

            setTimeout(() => {
                potValueEl.classList.remove('pot-updated');
            }, 600); // Coincide con la duración de la nueva animación
        }
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    socket.on('joinedAsSpectator', (gameState) => {
        console.log('Te has unido como espectador. Pasando control a la vista de juego...');
        showGameView({ ...gameState, isSpectator: true });
    });

    socket.on('waitingConfirmed', () => {
        showToast('¡Listo! Te sentarás automáticamente cuando empiece la revancha.', 4000);
        addChatMessage(null, 'Estás en la lista de espera para la siguiente partida.', 'system');
    });


    function clearAllData() {
        const usersToKeep = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('registered_user_')) {
                usersToKeep[key] = localStorage.getItem(key);
            }
        }
        localStorage.clear();
        Object.keys(usersToKeep).forEach(key => {
            localStorage.setItem(key, usersToKeep[key]);
        });
        console.log('Cache limpiado - Estado reiniciado');
    }
    
    clearAllData();
    
    const MAX_SEATS = 4;
    function uid(prefix='id') { return prefix + '-' + Math.random().toString(36).slice(2,9); }
    function nowTs(){ return Date.now(); }
    
    const body = document.body;
    const lobbyOverlay = document.getElementById('lobby-overlay');
    const overlayContent = document.querySelector('.overlay-content');
    const chatEl = document.getElementById('lobby-chat');
    const chatInput = document.getElementById('lobby-chat-input-textarea');
    const roomsOverviewEl = document.getElementById('rooms-overview');
    const createRoomModal = document.getElementById('create-room-modal');
    const btnCreateRoomConfirm = document.getElementById('btn-create-room-confirm');
    const btnCreateRoomCancel = document.getElementById('btn-create-room-cancel');
    const betInput = document.getElementById('bet-input');
    const penaltyInput = document.getElementById('penalty-input');
    const createRoomError = document.getElementById('create-room-error');
    const btnRules = document.getElementById('btn-rules');
    const rulesModal = document.getElementById('rules-modal');
    const btnCloseRulesModal = document.getElementById('btn-close-rules-modal');
    const btnSendChat = document.getElementById('btn-send-chat');
    const btnLogout = document.getElementById('btn-logout');
    const userCreditsEl = document.getElementById('user-credits');
    const userAvatarEl = document.getElementById('user-avatar');
    const avatarInput = document.getElementById('avatar-input');
    const btnReloadCredits = document.getElementById('btn-reload-credits');
    const creditModal = document.getElementById('credit-modal');
    const btnCloseCreditModal = document.getElementById('btn-close-credit-modal');
    const loginModal = document.getElementById('login-modal');
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');
    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');
    const registerModal = document.getElementById('register-modal');
    const registerNameInput = document.getElementById('register-name');
    const registerCountrySelect = document.getElementById('register-country');
    const registerWhatsAppInput = document.getElementById('register-whatsapp');
    const registerPasswordInput = document.getElementById('register-password');
    const registerConfirmPasswordInput = document.getElementById('register-confirm-password');
    const registerError = document.getElementById('register-error');
    const registerSuccess = document.getElementById('register-success');
    const btnRegisterSubmit = document.getElementById('btn-register-submit');
    const btnRegisterBack = document.getElementById('btn-register-back');
    const avatarGallery = document.getElementById('avatar-gallery');
    const avatarPreview = document.getElementById('avatar-preview');
    const avatarPreviewContainer = document.getElementById('avatar-preview-container');
    const registerAvatarUpload = document.getElementById('register-avatar-upload');
    const avatarCropModal = document.getElementById('avatar-crop-modal');
    const cropContainer = document.getElementById('crop-container');
    const cropImageWrapper = document.getElementById('crop-image-wrapper');
    const cropImagePreview = document.getElementById('crop-image-preview');
    const zoomSlider = document.getElementById('zoom-slider');
    const btnSaveCrop = document.getElementById('btn-save-crop');
    const btnCancelCrop = document.getElementById('btn-cancel-crop');
    let localPlayerId = localStorage.getItem('la51_local_player_id') || uid('p');
    localStorage.setItem('la51_local_player_id', localPlayerId);

    const countries = [
        { name: "España", code: "ES", phone: "+34" }, { name: "México", code: "MX", phone: "+52" },
        { name: "Argentina", code: "AR", phone: "+54" }, { name: "Colombia", code: "CO", phone: "+57" },
        { name: "Chile", code: "CL", phone: "+56" }, { name: "Perú", code: "PE", phone: "+51" },
        { name: "Venezuela", code: "VE", phone: "+58" }, { name: "Ecuador", code: "EC", phone: "+593" },
        { name: "Bolivia", code: "BO", phone: "+591" }, { name: "Paraguay", code: "PY", phone: "+595" },
        { name: "Uruguay", code: "UY", phone: "+598" }, { name: "Costa Rica", code: "CR", phone: "+506" },
        { name: "Panamá", code: "PA", phone: "+507" }, { name: "República Dominicana", code: "DO", phone: "+1" },
        { name: "Honduras", code: "HN", phone: "+504" }, { name: "El Salvador", code: "SV", phone: "+503" },
        { name: "Nicaragua", code: "NI", phone: "+505" }, { name: "Guatemala", code: "GT", phone: "+502" },
        { name: "Cuba", code: "CU", phone: "+53" }, { name: "Puerto Rico", code: "PR", phone: "+1" },
        { name: "Estados Unidos", code: "US", phone: "+1" }
    ];
    const defaultAvatars = [ 'https://i.pravatar.cc/150?img=1', 'https://i.pravatar.cc/150?img=2', 'https://i.pravatar.cc/150?img=3', 'https://i.pravatar.cc/150?img=4', 'https://i.pravatar.cc/150?img=5', 'https://i.pravatar.cc/150?img=6', 'https://i.pravatar.cc/150?img=7', 'https://i.pravatar.cc/150?img=8', 'https://i.pravatar.cc/150?img=9', 'https://i.pravatar.cc/150?img=10' ];
    let selectedAvatar = null;
    let currentPhonePrefix = '';
    let onCropCompleteCallback = null; // <-- AÑADE ESTA LÍNEA

    function scaleAndCenterLobby() {
        // ▼▼▼ PEGA ESTE BLOQUE COMPLETO AQUÍ DENTRO ▼▼▼
        // Este código desactiva el escalado y deja que el CSS funcione en todos los tamaños
        const overlayContent = document.querySelector('.overlay-content');
        if (overlayContent) {
            // Limpiar todos los estilos inline que puedan interferir con el CSS
            overlayContent.style.transform = '';
            overlayContent.style.left = '';
            overlayContent.style.top = '';
            overlayContent.style.width = '';
            overlayContent.style.height = '';
            overlayContent.style.maxWidth = '';
            overlayContent.style.maxHeight = '';
            overlayContent.style.position = 'relative';
            overlayContent.style.margin = '';
        }
        
        // En móviles, retornar para que el CSS maneje todo
        if (window.innerWidth <= 992) {
            return; // <-- ESTA LÍNEA ES LA MÁS IMPORTANTE
        }
        // En desktop, también dejamos que el CSS maneje todo ahora
        return;
        // ▲▲▲ FIN DEL BLOQUE A PEGAR ▲▲▲

        if (window.getComputedStyle(lobbyOverlay).display === 'none' || !body.classList.contains('is-logged-in')) {
            overlayContent.style.transform = '';
            overlayContent.style.left = '';
            overlayContent.style.top = '';
            overlayContent.style.position = 'relative'; 
            return;
        }
        const lobbyWidth = 1100; const lobbyHeight = 700;
        const viewportWidth = window.innerWidth; const viewportHeight = window.innerHeight;
        const scale = Math.min(viewportWidth / lobbyWidth, viewportHeight / lobbyHeight);
        overlayContent.style.transformOrigin = 'top left';
        overlayContent.style.transform = `scale(${scale})`;
        const newWidth = lobbyWidth * scale; const newHeight = lobbyHeight * scale;
        const left = (viewportWidth - newWidth) / 2; const top = (viewportHeight - newHeight) / 2;
        overlayContent.style.position = 'absolute';
        overlayContent.style.left = `${left}px`;
        overlayContent.style.top = `${top}px`;
    }

    function updateCreditsDisplay() {
        const credits = currentUser.credits ?? 0;
        const currency = currentUser.currency || 'USD'; // Usamos USD como fallback
        let formattedText = 'Créditos ';

        // Usamos un formato especial para cada moneda
        if (currency === 'EUR') {
            // Ejemplo: Créditos 10€
            formattedText += credits.toLocaleString('es-ES') + '€';
        } else if (currency === 'COP') {
            // Ejemplo: Créditos 100.000 COP
            formattedText += credits.toLocaleString('es-CO') + ' ' + currency;
        } else {
            // Ejemplo para USD y otras futuras monedas: Créditos 20 USD
            formattedText += credits.toLocaleString() + ' ' + currency;
        }

        userCreditsEl.textContent = formattedText;
    }
    window.updateLobbyCreditsDisplay = updateCreditsDisplay;
    
    // ▼▼▼ REEMPLAZA EL LISTENER DEL avatarInput CON ESTE ▼▼▼
    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                // Llamamos al modal de recorte y le decimos qué hacer cuando se guarde
                openCropModal(evt.target.result, (croppedDataUrl) => {
                    // Enviar la foto recortada al servidor para guardarla en la base de datos
                    // Intentar obtener el username de múltiples fuentes
                    let username = currentUser?.username;
                    if (!username) {
                        username = sessionStorage.getItem('username');
                    }
                    if (!username) {
                        username = localStorage.getItem('username');
                    }
                    
                    console.log('[AVATAR-UPDATE] Intentando actualizar avatar:', { 
                        username: username, 
                        currentUser: currentUser,
                        hasCroppedData: !!croppedDataUrl,
                        croppedDataLength: croppedDataUrl ? croppedDataUrl.length : 0
                    });
                    
                    if (username) {
                        // Mostrar mensaje de carga
                        showToast('Guardando avatar...', 2000);
                        
                        fetch('/update-avatar', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: username, avatar: croppedDataUrl })
                        })
                        .then(res => {
                            console.log('[AVATAR-UPDATE] Respuesta del servidor:', res.status, res.statusText);
                            if (!res.ok) {
                                throw new Error(`HTTP error! status: ${res.status}`);
                            }
                            return res.json();
                        })
                        .then(data => {
                            console.log('[AVATAR-UPDATE] Datos recibidos:', data);
                            if (data.success) {
                                userAvatarEl.src = croppedDataUrl; // Actualiza el avatar del lobby
                                if (currentUser) {
                                    currentUser.userAvatar = croppedDataUrl; // Actualiza la variable global
                                }
                                sessionStorage.setItem('userAvatar', croppedDataUrl); // Guarda en sessionStorage
                                localStorage.setItem('userAvatar', croppedDataUrl); // Guarda en localStorage
                                showToast('Avatar actualizado con éxito.', 2500);
                            } else {
                                console.error('[AVATAR-UPDATE] Error del servidor:', data.message);
                                showToast('Error: ' + (data.message || 'Error al actualizar el avatar.'), 3000);
                            }
                        })
                        .catch(error => {
                            console.error('[AVATAR-UPDATE] Error al actualizar avatar:', error);
                            showToast('Error al actualizar el avatar. Ver consola para más detalles.', 3000);
                        });
                    } else {
                        console.error('[AVATAR-UPDATE] No se encontró el nombre de usuario en ningún lugar');
                        console.error('[AVATAR-UPDATE] currentUser:', currentUser);
                        console.error('[AVATAR-UPDATE] sessionStorage username:', sessionStorage.getItem('username'));
                        console.error('[AVATAR-UPDATE] localStorage username:', localStorage.getItem('username'));
                        showToast('Error: No se encontró el nombre de usuario. Por favor, recarga la página.', 3000);
                    }
                });
            };
            reader.onerror = function(error) {
                console.error('Error al leer el archivo:', error);
                showToast('Error al leer el archivo de imagen.', 3000);
            };
            reader.readAsDataURL(file);
        } else {
            showToast('Por favor, selecciona un archivo de imagen válido.', 3000);
        }
        // Limpiar el input para permitir seleccionar el mismo archivo nuevamente
        e.target.value = '';
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    btnReloadCredits.addEventListener('click', () => {
        // 1. Obtiene el nombre de usuario actual de la variable global.
        const username = currentUser.username || 'Usuario no identificado';

        // 2. Prepara el mensaje y lo codifica para una URL.
        const message = `Hola, mi nombre de usuario es ${username} y quiero recargar/retirar los créditos EN EL JUEGO LA 51. Me das información por favor. Gracias.`;
        const encodedMessage = encodeURIComponent(message);

        // 3. Selecciona los dos enlaces por su ID.
        const primaryLink = document.getElementById('whatsapp-link-primary');
        const secondaryLink = document.getElementById('whatsapp-link-secondary');

        // 4. Construye y asigna las URLs completas a los enlaces.
        if (primaryLink) {
            primaryLink.href = `https://wa.me/34665530984?text=${encodedMessage}`;
        }
        if (secondaryLink) {
            secondaryLink.href = `https://wa.me/573004280833?text=${encodedMessage}`;
        }

        // 5. Finalmente, muestra el modal ya con los enlaces listos.
        creditModal.style.display = 'flex';
    });
    btnCloseCreditModal.addEventListener('click', () => { creditModal.style.display = 'none'; });
    
    // ▼▼▼ LISTENERS PARA MODAL "OLVIDÉ MI CONTRASEÑA" ▼▼▼
    const btnForgotPassword = document.getElementById('btn-forgot-password');
    const forgotPasswordModal = document.getElementById('forgot-password-modal');
    const btnCloseForgotModal = document.getElementById('btn-close-forgot-modal');

    if (btnForgotPassword && forgotPasswordModal && btnCloseForgotModal) {
        btnForgotPassword.addEventListener('click', (e) => {
            e.preventDefault();
            forgotPasswordModal.style.display = 'flex';
        });

        btnCloseForgotModal.addEventListener('click', () => {
            forgotPasswordModal.style.display = 'none';
        });
    }
    // ▲▲▲ FIN LISTENERS "OLVIDÉ MI CONTRASEÑA" ▲▲▲
    
    btnRules.addEventListener('click', () => { rulesModal.style.display = 'flex'; });
    btnCloseRulesModal.addEventListener('click', () => { rulesModal.style.display = 'none'; });

    function createRoom() {
        createRoomError.style.display = 'none';
        betInput.value = 10;
        penaltyInput.value = 5;
        createRoomModal.style.display = 'flex';
    }

    function confirmCreateRoom() {
        const bet = parseInt(betInput.value);
        const penalty = parseInt(penaltyInput.value);
        
        // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
        const currency = document.getElementById('create-room-currency').value;

        if (isNaN(bet) || bet <= 0) {
            createRoomError.textContent = 'La apuesta debe ser un número positivo.';
            createRoomError.style.display = 'block';
            return;
        }
        if (isNaN(penalty) || penalty < 0) {
            createRoomError.textContent = 'La multa debe ser un número cero o positivo.';
            createRoomError.style.display = 'block';
            return;
        }
        const totalCostInRoomCurrency = bet + penalty; // El coste total es apuesta + multa.

        // Obtenemos los datos del usuario y la moneda de la mesa
        const userCredits = currentUser.credits ?? 0;
        const userCurrency = currentUser.currency || 'USD';
        const roomCurrency = document.getElementById('create-room-currency').value;

        let requiredAmountInUserCurrency = totalCostInRoomCurrency;

        // Hacemos la conversión solo si las monedas son diferentes
        if (roomCurrency !== userCurrency && clientExchangeRates[userCurrency] && clientExchangeRates[userCurrency][roomCurrency]) {
            requiredAmountInUserCurrency = totalCostInRoomCurrency / clientExchangeRates[userCurrency][roomCurrency];
        } else if (roomCurrency !== userCurrency && clientExchangeRates[roomCurrency] && clientExchangeRates[roomCurrency][userCurrency]) {
            requiredAmountInUserCurrency = totalCostInRoomCurrency * clientExchangeRates[roomCurrency][userCurrency];
        }

        // Comparamos los créditos del usuario con el coste convertido a su moneda
        if (userCredits < requiredAmountInUserCurrency) {
            const friendlyBet = bet.toLocaleString('es-ES');
            const friendlyPenalty = penalty.toLocaleString('es-ES');

            createRoomError.innerHTML = `Créditos insuficientes. <br>Para crear la mesa (${friendlyBet} + ${friendlyPenalty} de multa) necesitas el equivalente a <strong>${requiredAmountInUserCurrency.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrency}</strong>.`;
            createRoomError.style.display = 'block';
            return;
        }
        
        // MIGRACIÓN SEGURA: Usar variables globales con fallback a localStorage
        const username = currentUser.username || localStorage.getItem('username') || 'Jugador';
        const userAvatar = currentUser.userAvatar || localStorage.getItem('userAvatar') || defaultAvatars[0];
        const userId = currentUser.userId || localStorage.getItem('userId');
        
        const roomSettings = {
            username: username,
            userAvatar: userAvatar,
            userId: userId, // MIGRACIÓN SEGURA: Usar variables globales
            tableName: `Mesa de ${username}`,
            bet: bet,
            penalty: penalty,
            betCurrency: currency // <-- AÑADE ESTA LÍNEA
        };
        socket.emit('createRoom', roomSettings);
        createRoomModal.style.display = 'none';
    }

    btnCreateRoomConfirm.addEventListener('click', confirmCreateRoom);
    btnCreateRoomCancel.addEventListener('click', () => { createRoomModal.style.display = 'none'; });
    
    btnSendChat.addEventListener('click', () => {
        const txt = chatInput.value.trim();
        if (txt) sendChat(txt);
    });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            btnSendChat.click();
        }
    });

    btnLogout.addEventListener('click', () => {
        console.log('🔌 [CLIENTE DEBUG] Logout clickeado - desconectando socket');
        console.log('🔌 [CLIENTE DEBUG] Stack trace:', new Error().stack);
        socket.disconnect(); 
        
        // MIGRACIÓN SEGURA: Limpiar tanto variables globales como localStorage y sessionStorage
        currentUser = {
            username: '',
            userAvatar: '',
            userId: '',
            credits: 1000
        };
        
        // Limpiar localStorage
        localStorage.removeItem('username');
        localStorage.removeItem('userAvatar');
        localStorage.removeItem('userCredits');
        localStorage.removeItem('userId');
        
        // Limpiar sessionStorage para cerrar sesión completamente
        sessionStorage.removeItem('username');
        sessionStorage.removeItem('userAvatar');
        sessionStorage.removeItem('userId');
        sessionStorage.removeItem('userCurrency');
        
        // Redirigir al login general
        window.location.href = '/';
    });


    function getRoomStatePriority(r) {
        const seated = (r.seats || []).filter(Boolean).length;
        if (seated > 0) {
            if (r.state === 'playing') return 2;
            return 1;
        }
        return 3;
    }

    function handleJoinRoom(roomId, mode = 'wantsToPlay') {
        spectatorMode = mode;
        
        // MIGRACIÓN SEGURA: Usar variables globales con fallback a localStorage
        const user = {
            username: currentUser.username || localStorage.getItem('username') || 'Invitado',
            userAvatar: currentUser.userAvatar || localStorage.getItem('userAvatar') || defaultAvatars[0],
            userId: currentUser.userId || localStorage.getItem('userId') // MIGRACIÓN SEGURA: Usar variables globales
        };
        
        console.log(`[JoinRoom] Usuario: ${user.username} (ID: ${user.userId}) - Migración segura`);
        socket.emit('joinRoom', { roomId, user });
    }

// REEMPLAZA LA FUNCIÓN renderRoomsOverview ENTERA CON ESTO:
// REEMPLAZA LA FUNCIÓN renderRoomsOverview ENTERA CON ESTA VERSIÓN MEJORADA
function renderRoomsOverview(rooms = []) {
    if (!roomsOverviewEl) return;
    roomsOverviewEl.innerHTML = ''; // Limpiar la vista

    // --- MESA DE PRÁCTICA (Sin cambios) ---
    const practiceTable = document.createElement('div');
    practiceTable.className = 'table-item';
    practiceTable.innerHTML = `
        <div class="info">
            <div><strong>Modo Práctica</strong></div>
            <p style="font-size: 0.85rem; line-height: 1.3; margin-top: 10px; margin-bottom: 10px;">Aprende a jugar con bots.</p>
        </div>
        <div class="actions">
            <button class="play-button">Jugar</button>
        </div>
    `;
    practiceTable.querySelector('button').onclick = () => {
        // Usamos la variable global 'currentUser' que es más fiable.
        const username = currentUser.username || 'Jugador';
        const avatar = currentUser.userAvatar || ''; // Obtenemos el avatar actual.
        socket.emit('requestPracticeGame', { username, avatar }); // Enviamos un objeto.
    };
    roomsOverviewEl.appendChild(practiceTable);

    // --- BOTÓN DE CREAR MESA (Sin cambios) ---
    const createTableItem = document.createElement('div');
    createTableItem.className = 'table-item no-rooms';
    createTableItem.innerHTML = `
        <div class="info">
            <p>${rooms.length === 0 ? 'No hay mesas. ¡Crea una!' : 'Crear una nueva mesa'}</p>
        </div>
        <div class="actions">
            <button class="play-button">Crear Mesa</button>
        </div>`;
    createTableItem.querySelector('button').onclick = createRoom;
    roomsOverviewEl.appendChild(createTableItem);

    if (!Array.isArray(rooms)) {
        console.error("Error: el dato 'rooms' recibido no es un array.", rooms);
        return;
    }

    // --- INICIO DE LAS MODIFICACIONES ---

    // 1. CREAMOS UNA FUNCIÓN AUXILIAR REUTILIZABLE PARA LAS CONVERSIONES
    // Esto nos permitirá usarla tanto para la apuesta como para la multa.
    const getConvertedValueHTML = (amount, fromCurrency) => {
        if (!currentUser.currency || fromCurrency === currentUser.currency || !clientExchangeRates) {
            return ''; // No se necesita conversión
        }
        
        let convertedAmount = 0;
        if (clientExchangeRates[fromCurrency] && clientExchangeRates[fromCurrency][currentUser.currency]) {
            convertedAmount = amount * clientExchangeRates[fromCurrency][currentUser.currency];
        } else if (clientExchangeRates[currentUser.currency] && clientExchangeRates[currentUser.currency][fromCurrency]) {
            convertedAmount = amount / clientExchangeRates[currentUser.currency][fromCurrency];
        }

        if (convertedAmount > 0) {
            const formattedAmount = convertedAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return `<span style="font-size: 0.75rem; color: #aaa;"> (Aprox. ${formattedAmount} ${currentUser.currency})</span>`;
        }
        return '';
    };

    // --- FIN DE LA MODIFICACIÓN 1 ---

    rooms.sort((a, b) => getRoomStatePriority(a) - getRoomStatePriority(b));

    rooms.forEach(roomData => {
        // ▼▼▼ AÑADE ESTA LÍNEA AQUÍ ▼▼▼
        if (roomData.isPractice) return; // Si la mesa es de práctica, no la mostramos y pasamos a la siguiente.
        // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

        try {
            const div = document.createElement('div');
            div.className = 'table-item';

            const seated = (roomData.seats || []).filter(Boolean).length;
            const bet = parseInt(roomData.settings?.bet || 0);
            const penalty = parseInt(roomData.settings?.penalty || 0); // Obtenemos la multa
            const hostUsername = roomData.settings?.username || 'Desconocido';
            const isEffectivelyPlaying = roomData.state === 'playing' || roomData.state === 'post-game';
            const betCurrency = roomData.settings?.betCurrency || 'USD';

            // --- INICIO DE LA MODIFICACIÓN 2 ---
            // 2. USAMOS LA FUNCIÓN AUXILIAR PARA APUESTA Y MULTA
            const convertedBetHTML = getConvertedValueHTML(bet, betCurrency);
            const convertedPenaltyHTML = getConvertedValueHTML(penalty, betCurrency);
            // --- FIN DE LA MODIFICACIÓN 2 ---

            let stateText = isEffectivelyPlaying ? `Jugando (${seated} / 4)` : `En espera (${seated} / 4)`;
            const seatedPlayerNames = (roomData.seats || []).map(seat => seat ? seat.playerName : null).filter(Boolean);

            // Se actualiza el innerHTML para mostrar la multa con su conversión
            div.innerHTML = `
                <div class="info">
                    <div><strong>Mesa de:</strong> ${hostUsername}</div>
                    <div><strong>Estado:</strong> ${stateText}</div>
                    <div><strong>Apuesta:</strong> ${bet.toLocaleString('es-ES')} ${betCurrency}${convertedBetHTML}</div>
                    <div><strong>Multa:</strong> ${penalty.toLocaleString('es-ES')} ${betCurrency}${convertedPenaltyHTML}</div>
                    <div class="player-list"><strong>Jugadores:</strong> ${seatedPlayerNames.length > 0 ? seatedPlayerNames.join(', ') : '-'}</div>
                </div>
                <div class="actions"></div>
            `;

            const actionsContainer = div.querySelector('.actions');
            const btnEnter = document.createElement('button');
            btnEnter.textContent = 'Entrar';
            btnEnter.className = 'play-button';

            const isFull = seated >= 4;
            const requirementInRoomCurrency = bet + penalty;

            // Calculamos el coste en la moneda del jugador
            let requiredAmountInPlayerCurrency = requirementInRoomCurrency;
            if (currentUser.currency && betCurrency !== currentUser.currency) {
                 if (clientExchangeRates[currentUser.currency] && clientExchangeRates[currentUser.currency][betCurrency]) {
                    requiredAmountInPlayerCurrency = requirementInRoomCurrency / clientExchangeRates[currentUser.currency][betCurrency];
                }
            }
            
            const hasEnoughCredits = (currentUser.credits ?? 0) >= requiredAmountInPlayerCurrency;

            // --- INICIO DE LA CORRECCIÓN DEFINITIVA ---
            if (isFull) {
                btnEnter.disabled = true;
                btnEnter.title = 'Mesa llena.';
            } else {
                btnEnter.disabled = false;

                // Asignamos una única y nueva función onclick que valida todo en el momento.
                btnEnter.onclick = () => {
                    // 1. Obtenemos los datos más frescos en el instante del clic.
                    const userCreditsNow = currentUser.credits ?? 0;
                    const userCurrencyNow = currentUser.currency || 'USD';

                    const bet = parseInt(roomData.settings?.bet || 0);
                    const penalty = parseInt(roomData.settings?.penalty || 0);
                    const betCurrency = roomData.settings?.betCurrency || 'USD';

                    const requirementInRoomCurrency = bet + penalty;
                    let requiredInUserCurrency = requirementInRoomCurrency;

                    // 2. Realizamos la conversión de moneda.
                    if (userCurrencyNow !== betCurrency && clientExchangeRates) {
                         if (clientExchangeRates[betCurrency] && clientExchangeRates[betCurrency][userCurrencyNow]) {
                            requiredInUserCurrency = requirementInRoomCurrency * clientExchangeRates[betCurrency][userCurrencyNow];
                        } else if (clientExchangeRates[userCurrencyNow] && clientExchangeRates[userCurrencyNow][betCurrency]) {
                            requiredInUserCurrency = requirementInRoomCurrency / clientExchangeRates[userCurrencyNow][betCurrency];
                        }
                    }

                    // 3. Comparamos los créditos del usuario con el requisito.
                    console.log(`VALIDANDO: Créditos=${userCreditsNow} ${userCurrencyNow} vs Requerido=${requiredInUserCurrency.toFixed(2)} ${userCurrencyNow}`);

                    if (userCreditsNow >= requiredInUserCurrency) {
                        // Si tiene créditos, se une a la mesa.
                        handleJoinRoom(roomData.roomId);
                    } else {
                        // Si NO tiene créditos, llamamos a nuestra nueva función de modal.
                        const missingAmount = requiredInUserCurrency - userCreditsNow;

                        const friendlyRequired = `${requiredInUserCurrency.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrencyNow}`;
                        const friendlyMissing = `${missingAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrencyNow}`;

                        showInsufficientFundsModal(friendlyRequired, friendlyMissing);
                    }
                };
            }

            if (isEffectivelyPlaying && isFull) {
                 btnEnter.title = 'La mesa está llena.';
            }

            actionsContainer.appendChild(btnEnter);
            // --- FIN DE LA CORRECCIÓN DEFINITIVA ---
            
            roomsOverviewEl.appendChild(div);

        } catch (error) {
            console.error(`ERROR al renderizar la mesa:`, error, roomData);
        }
    });
}
    
    // ▼▼▼ REEMPLAZA TU FUNCIÓN sendChat ENTERA CON ESTA ▼▼▼
    function sendChat(text) {
        if (!text) return;

        // Obtenemos el nombre del usuario actual de la variable global
        const senderName = currentUser.username || 'Invitado';

        // Enviamos el mensaje al servidor en lugar de a localStorage
        socket.emit('sendLobbyChat', { text: text, sender: senderName });

        // Limpiamos el input localmente
        chatInput.value = '';
    }
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    // ▼▼▼ REEMPLAZA TU FUNCIÓN renderGlobalChat ENTERA CON ESTAS DOS FUNCIONES ▼▼▼

    // Función 1: Añade un solo mensaje al DOM
    function addLobbyChatMessage(msg) {
        const m = document.createElement('div');
        m.style.marginBottom = '6px';

        const who = document.createElement('div');
        who.style.fontSize = '12px';
        who.style.color = '#6D2932';
        who.style.textDecoration = 'underline'; // <-- LÍNEA AÑADIDA
        who.textContent = msg.from;

        const txt = document.createElement('div');
        txt.textContent = msg.text;

        const ts = document.createElement('div');
        ts.style.fontSize = '11px';
        ts.style.color = '#888';
        ts.textContent = new Date(msg.ts).toLocaleTimeString();

        m.appendChild(who);
        m.appendChild(txt);
        m.appendChild(ts);

        chatEl.appendChild(m);
        chatEl.scrollTop = chatEl.scrollHeight; // Auto-scroll
    }

    // Función 2: Renderiza un array completo de mensajes (para el historial)
    function renderLobbyChat(messages = []) {
        chatEl.innerHTML = ''; // Limpiamos el chat
        if (messages.length === 0) {
            // ▼▼▼ BLOQUE MODIFICADO ▼▼▼
            const welcomeDiv = document.createElement('div');
            welcomeDiv.style.fontStyle = 'italic';
            welcomeDiv.style.color = '#888';
            welcomeDiv.style.textAlign = 'center';
            welcomeDiv.style.padding = '10px 0';
            welcomeDiv.textContent = '¡Bienvenido al lobby de LA 51! Sé respetuoso y disfruta del juego.';
            chatEl.appendChild(welcomeDiv);
            // ▲▲▲ FIN DEL BLOQUE ▲▲▲
        } else {
            messages.forEach(msg => addLobbyChatMessage(msg));
        }
    }
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    
// REEMPLAZA LA FUNCIÓN showRoomsOverview ENTERA CON ESTO
function showRoomsOverview() {
    if(roomsOverviewEl) roomsOverviewEl.style.display='grid';
    renderGlobalChat();
}

    function showLoginModal() {
        loginError.style.display = 'none';
        loginUsernameInput.value = ''; loginPasswordInput.value = '';
        loginModal.style.display = 'flex';
    }
    
    function showRegisterModal() {
        registerError.style.display = 'none'; registerSuccess.style.display = 'none';
        registerNameInput.value = ''; registerCountrySelect.value = ''; registerWhatsAppInput.value = '';
        registerPasswordInput.value = ''; registerConfirmPasswordInput.value = '';
        selectedAvatar = null; avatarPreviewContainer.style.display = 'none';
        populateAvatarGallery();
        loginModal.style.display = 'none'; registerModal.style.display = 'flex';
    }


    function doLogin() {
        initAudioContext(); // <-- AÑADE ESTA LÍNEA (REFUERZO)

        const username = loginUsernameInput.value.trim();
        const password = loginPasswordInput.value.trim();
        loginError.style.display = 'none';

        if (!username || !password) {
            loginError.textContent = 'Por favor, ingresa nombre y contraseña.';
            loginError.style.display = 'block';
            return;
        }

        fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const user = data.user;
                
                // Conectar socket solo si no está ya conectado
                if (!socket.connected) {
                    socket.connect();
                }
                socket.emit('userLoggedIn', { username: user.name, currency: user.currency });

                // Guardar datos en la variable global para la sesión
                currentUser = {
                    username: user.name,
                    userAvatar: user.avatar,
                    userId: 'user_' + user.name.toLowerCase(),
                    currency: user.currency
                };
                
                // Guardar en sessionStorage para mantener la sesión entre juegos
                sessionStorage.setItem('username', user.name);
                sessionStorage.setItem('userAvatar', user.avatar);
                sessionStorage.setItem('userId', 'user_' + user.name.toLowerCase());
                sessionStorage.setItem('userCurrency', user.currency);
                
                // Guardar también en localStorage para compatibilidad
                localStorage.setItem('username', user.name);
                localStorage.setItem('userAvatar', user.avatar);
                localStorage.setItem('userId', 'user_' + user.name.toLowerCase());
                
                loginModal.style.display = 'none';
                document.getElementById('user-name').textContent = user.name;
                userAvatarEl.src = user.avatar;
                
                body.classList.add('is-logged-in');
                lobbyOverlay.style.display = 'flex';

                // ▼▼▼ AÑADE ESTA LÍNEA AQUÍ ▼▼▼
                showPwaInstallModal(); 
                // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

                setTimeout(scaleAndCenterLobby, 0);
                window.addEventListener('resize', scaleAndCenterLobby);

            } else {
                loginError.textContent = data.message;
                loginError.style.display = 'block';
            }
        })
        .catch(err => {
            console.error('Error de red en el login:', err);
            loginError.textContent = 'Error de conexión. Inténtalo de nuevo.';
            loginError.style.display = 'block';
        });
    }

    function doRegister() {
        registerError.style.display = 'none';
        registerSuccess.style.display = 'none';

        const name = registerNameInput.value.trim();
        const country = registerCountrySelect.value;
        const whatsapp = registerWhatsAppInput.value.trim();
        const password = registerPasswordInput.value;
        const confirmPassword = registerConfirmPasswordInput.value;
        const currency = document.getElementById('register-currency').value;

        if (!name || !country || !whatsapp || !password || !currency) {
            registerError.textContent = 'Por favor, completa todos los campos.';
            registerError.style.display = 'block';
            return;
        }
        if (password !== confirmPassword) {
            registerError.textContent = 'Las contraseñas no coinciden.';
            registerError.style.display = 'block';
            return;
        }
        if (!selectedAvatar) {
            registerError.textContent = 'Por favor, selecciona un avatar.';
            registerError.style.display = 'block';
            return;
        }

        fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, country, whatsapp, password, avatar: selectedAvatar, currency })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                registerSuccess.textContent = data.message + ' Serás redirigido al login.';
                registerSuccess.style.display = 'block';
                setTimeout(() => {
                    registerModal.style.display = 'none';
                    showLoginModal();
                    loginUsernameInput.value = name; // Autocompletar el nombre
                }, 2500);
            } else {
                registerError.textContent = data.message;
                registerError.style.display = 'block';
            }
        })
        .catch(err => {
            console.error('Error de red en el registro:', err);
            registerError.textContent = 'Error de conexión. Inténtalo de nuevo.';
            registerError.style.display = 'block';
        });
    }

    btnLogin.addEventListener('click', doLogin);
    btnRegister.addEventListener('click', showRegisterModal);
    btnRegisterSubmit.addEventListener('click', doRegister);
    btnRegisterBack.addEventListener('click', () => { registerModal.style.display = 'none'; showLoginModal(); });

    function initCountries() {
        countries.forEach(c => {
            const option = document.createElement('option');
            option.value = c.code; option.textContent = `${c.name} (${c.phone})`;
            registerCountrySelect.appendChild(option);
        });
        registerCountrySelect.addEventListener('change', () => {
            const selected = countries.find(c => c.code === registerCountrySelect.value);
            currentPhonePrefix = selected ? selected.phone : "";
            registerWhatsAppInput.value = currentPhonePrefix ? currentPhonePrefix + " " : "";
        });
        registerWhatsAppInput.addEventListener('input', () => { if (!registerWhatsAppInput.value.startsWith(currentPhonePrefix)) { registerWhatsAppInput.value = currentPhonePrefix + " "; } });
        registerWhatsAppInput.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && registerWhatsAppInput.selectionStart <= currentPhonePrefix.length + 1) e.preventDefault(); });
    }

    function populateAvatarGallery() {
        avatarGallery.innerHTML = '';
        const uploadOpt = document.createElement('div');
        uploadOpt.className = 'avatar-item'; uploadOpt.textContent = 'Subir Foto';
        uploadOpt.onclick = () => registerAvatarUpload.click();
        avatarGallery.appendChild(uploadOpt);
        defaultAvatars.forEach(url => {
            const item = document.createElement('div'); item.className = 'avatar-item';
            const img = document.createElement('img'); img.src = url;
            item.appendChild(img);
            item.addEventListener('click', () => {
                const current = avatarGallery.querySelector('.selected');
                if (current) current.classList.remove('selected');
                item.classList.add('selected');
                selectedAvatar = url;
                avatarPreview.src = url; avatarPreviewContainer.style.display = 'block';
            });
            avatarGallery.appendChild(item);
        });
    }

    let cropperState = { isDragging: false, startX: 0, startY: 0, wrapperX: 0, wrapperY: 0, scale: 1 };
    function openCropModal(imageDataUrl, callback) { // <-- Añade 'callback'
        onCropCompleteCallback = callback; // <-- AÑADE ESTA LÍNEA
        cropImagePreview.onload = () => {
            avatarCropModal.style.display = 'flex';
            cropperState = { isDragging: false, startX: 0, startY: 0, wrapperX: 0, wrapperY: 0, scale: 1 };
            zoomSlider.value = 100;
            const img = cropImagePreview, wrapper = cropImageWrapper, container = cropContainer;
            const containerSize = container.offsetWidth;
            let initialWidth, initialHeight;
            if (img.naturalWidth > img.naturalHeight) {
                initialHeight = containerSize; initialWidth = (img.naturalWidth / img.naturalHeight) * containerSize;
                cropperState.wrapperY = 0; cropperState.wrapperX = -(initialWidth - containerSize) / 2;
            } else {
                initialWidth = containerSize; initialHeight = (img.naturalHeight / img.naturalWidth) * containerSize;
                cropperState.wrapperX = 0; cropperState.wrapperY = -(initialHeight - containerSize) / 2;
            }
            wrapper.style.width = `${initialWidth}px`; wrapper.style.height = `${initialHeight}px`;
            wrapper.style.left = `${cropperState.wrapperX}px`; wrapper.style.top = `${cropperState.wrapperY}px`;
            img.style.transform = `scale(1)`;
        };
        cropImagePreview.src = imageDataUrl;
    }
    function closeCropModal() { avatarCropModal.style.display = 'none'; cropImagePreview.src = ''; registerAvatarUpload.value = ''; }
    function saveCrop() {
        const img = cropImagePreview, wrapper = cropImageWrapper, container = cropContainer, scale = cropperState.scale, containerSize = container.offsetWidth;
        const canvas = document.createElement('canvas'); canvas.width = containerSize; canvas.height = containerSize; const ctx = canvas.getContext('2d');
        ctx.beginPath(); ctx.arc(containerSize / 2, containerSize / 2, containerSize / 2, 0, Math.PI * 2, true); ctx.closePath(); ctx.clip();
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, containerSize, containerSize);
        const wrapperWidth = wrapper.offsetWidth, wrapperHeight = wrapper.offsetHeight;
        const scaledImgXInWrapper = (wrapperWidth - wrapperWidth * scale) / 2, scaledImgYInWrapper = (wrapperHeight - wrapperHeight * scale) / 2;
        const finalImgX = cropperState.wrapperX + scaledImgXInWrapper, finalImgY = cropperState.wrapperY + scaledImgYInWrapper;
        const finalImgWidth = wrapperWidth * scale, finalImgHeight = wrapperHeight * scale;
        ctx.drawImage(img, finalImgX, finalImgY, finalImgWidth, finalImgHeight);
        
        // Optimizar imagen: reducir tamaño y comprimir
        const optimizedSize = 300; // Tamaño máximo del avatar (300x300 píxeles)
        const optimizedCanvas = document.createElement('canvas');
        optimizedCanvas.width = optimizedSize;
        optimizedCanvas.height = optimizedSize;
        const optimizedCtx = optimizedCanvas.getContext('2d');
        optimizedCtx.drawImage(canvas, 0, 0, containerSize, containerSize, 0, 0, optimizedSize, optimizedSize);
        
        // Usar JPEG con calidad 0.85 para reducir tamaño (más pequeño que PNG)
        const dataUrl = optimizedCanvas.toDataURL('image/jpeg', 0.85);

        // ▼▼▼ REEMPLAZA LAS LÍNEAS FINALES CON ESTE BLOQUE ▼▼▼
        if (typeof onCropCompleteCallback === 'function') {
            onCropCompleteCallback(dataUrl); // Ejecutamos la acción guardada
        }
        onCropCompleteCallback = null; // Limpiamos la acción para futuros usos
        closeCropModal();
        // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    }
    cropContainer.addEventListener('mousedown', (e) => { e.preventDefault(); cropperState.isDragging = true; cropperState.startX = e.clientX - cropperState.wrapperX; cropperState.startY = e.clientY - cropperState.wrapperY; });
    window.addEventListener('mousemove', (e) => { if (!cropperState.isDragging || avatarCropModal.style.display !== 'flex') return; e.preventDefault(); cropperState.wrapperX = e.clientX - cropperState.startX; cropperState.wrapperY = e.clientY - cropperState.startY; cropImageWrapper.style.left = `${cropperState.wrapperX}px`; cropImageWrapper.style.top = `${cropperState.wrapperY}px`; });
    window.addEventListener('mouseup', (e) => { if (!cropperState.isDragging) return; cropperState.isDragging = false; });
    cropContainer.addEventListener('touchstart', (e) => { const touch = e.touches[0]; cropperState.isDragging = true; cropperState.startX = touch.clientX - cropperState.wrapperX; cropperState.startY = touch.clientY - cropperState.wrapperY; }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (!cropperState.isDragging || avatarCropModal.style.display !== 'flex') return; e.preventDefault(); const touch = e.touches[0]; cropperState.wrapperX = touch.clientX - cropperState.startX; cropperState.wrapperY = touch.clientY - cropperState.startY; cropImageWrapper.style.left = `${cropperState.wrapperX}px`; cropImageWrapper.style.top = `${cropperState.wrapperY}px`; }, { passive: false });
    window.addEventListener('touchend', (e) => { if (!cropperState.isDragging) return; cropperState.isDragging = false; });
    zoomSlider.addEventListener('input', (e) => { cropperState.scale = e.target.value / 100; cropImagePreview.style.transform = `scale(${cropperState.scale})`; });
    btnSaveCrop.addEventListener('click', saveCrop);
    btnCancelCrop.addEventListener('click', closeCropModal);
    // ▼▼▼ REEMPLAZA EL LISTENER DEL registerAvatarUpload CON ESTE ▼▼▼
    registerAvatarUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                // Llamamos al modal y le pasamos la acción específica para el registro
                openCropModal(evt.target.result, (croppedDataUrl) => {
                    selectedAvatar = croppedDataUrl;
                    avatarPreview.src = croppedDataUrl;
                    avatarPreviewContainer.style.display = 'block';
                    const current = avatarGallery.querySelector('.selected');
                    if (current) current.classList.remove('selected');
                    // Asumimos que el primer item es la opción de 'Subir Foto'
                    avatarGallery.firstChild.classList.add('selected');
                });
            };
            reader.readAsDataURL(file);
        }
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    
    (function init() {
        console.log('--- INICIANDO VERSIÓN CON LOGIN EN SERVIDOR ---');
        initCountries();

        // --- INICIO DEL BLOQUE DE REFUERZO DE AUDIO ---
        // Asignamos los listeners para la primera interacción del usuario
        // (tanto en el documento como en el botón de login).
        document.addEventListener('click', (e) => {
            // No interferir con el botón "Cambiar de Juego"
            if (e.target.closest('.button.secondary[onclick*="/select"]')) {
                return;
            }
            initAudioContext();
        }, true);
        document.addEventListener('touchend', (e) => {
            // No interferir con el botón "Cambiar de Juego"
            if (e.target.closest('.button.secondary[onclick*="/select"]')) {
                return;
            }
            initAudioContext();
        }, true);
        const btnLogin = document.getElementById('btn-login');
        if(btnLogin) {
            btnLogin.addEventListener('click', initAudioContext);
        }
        // --- FIN DEL BLOQUE DE REFUERZO ---
        
        // ▼▼▼ VERIFICAR SESIÓN GUARDADA Y AUTO-LOGIN ▼▼▼
        const savedUsername = sessionStorage.getItem('username');
        const savedUserAvatar = sessionStorage.getItem('userAvatar');
        const savedUserId = sessionStorage.getItem('userId');
        const savedUserCurrency = sessionStorage.getItem('userCurrency');
        
        if (savedUsername && savedUserId) {
            // Hay una sesión guardada, conectarse automáticamente
            console.log('Sesión encontrada, conectando automáticamente...');
            
            // Configurar currentUser con los datos guardados
            currentUser = {
                username: savedUsername,
                userAvatar: savedUserAvatar || defaultAvatars[0],
                userId: savedUserId,
                currency: savedUserCurrency || 'USD'
            };
            
            // Guardar también en localStorage para compatibilidad
            localStorage.setItem('username', savedUsername);
            if (savedUserAvatar) localStorage.setItem('userAvatar', savedUserAvatar);
            if (savedUserId) localStorage.setItem('userId', savedUserId);
            
            // Conectar socket solo si no está ya conectado
            if (!socket.connected) {
                socket.connect();
            }
            socket.emit('userLoggedIn', { 
                username: savedUsername, 
                currency: savedUserCurrency || 'USD' 
            });
            
            // Configurar UI
            document.getElementById('user-name').textContent = savedUsername;
            if (savedUserAvatar) {
                userAvatarEl.src = savedUserAvatar;
            }
            body.classList.add('is-logged-in');
            lobbyOverlay.style.display = 'flex';
            loginModal.style.display = 'none';
            
            setTimeout(scaleAndCenterLobby, 0);
            window.addEventListener('resize', scaleAndCenterLobby);
        } else {
            // No hay sesión, mostrar modal de login
            body.classList.remove('is-logged-in');
            lobbyOverlay.style.display = 'none';
            showLoginModal();
        }
        // ▲▲▲ FIN DE LA VERIFICACIÓN DE SESIÓN ▲▲▲
        
        // ▼▼▼ INICIO DEL BLOQUE DE CÓDIGO PARA CAMBIAR CONTRASEÑA ▼▼▼
        console.log('TEST: JavaScript actualizado - Modal cambiar contraseña');
        const btnChangePassword = document.getElementById('btn-change-password');
        const changePasswordModal = document.getElementById('change-password-modal');

        if (btnChangePassword && changePasswordModal) {
            const currentPassInput = document.getElementById('current-password');
            const newPassInput = document.getElementById('new-password');
            const confirmNewPassInput = document.getElementById('confirm-new-password');
            const errorDiv = document.getElementById('change-password-error');
            const successDiv = document.getElementById('change-password-success');
            const btnConfirm = document.getElementById('btn-confirm-change-password');
            const btnCancel = document.getElementById('btn-cancel-change-password');

            // Función para abrir el modal y resetearlo
            const openChangePasswordModal = () => {
                currentPassInput.value = '';
                newPassInput.value = '';
                confirmNewPassInput.value = '';
                errorDiv.style.display = 'none';
                successDiv.style.display = 'none';
                btnConfirm.disabled = false;
                changePasswordModal.style.display = 'flex';
            };

            // Función para cerrar el modal
            const closeChangePasswordModal = () => {
                changePasswordModal.style.display = 'none';
            };

            // Función para enviar los datos al servidor
            const submitPasswordChange = () => {
                errorDiv.style.display = 'none';
                successDiv.style.display = 'none';

                const currentPassword = currentPassInput.value;
                const newPassword = newPassInput.value;
                const confirmNewPassword = confirmNewPassInput.value;

                if (!currentPassword || !newPassword) {
                    errorDiv.textContent = 'Todos los campos son obligatorios.';
                    errorDiv.style.display = 'block';
                    return;
                }
                if (newPassword.length < 4) {
                    errorDiv.textContent = 'La nueva contraseña debe tener al menos 4 caracteres.';
                    errorDiv.style.display = 'block';
                    return;
                }
                if (newPassword !== confirmNewPassword) {
                    errorDiv.textContent = 'Las nuevas contraseñas no coinciden.';
                    errorDiv.style.display = 'block';
                    return;
                }

                btnConfirm.disabled = true;
                btnConfirm.textContent = 'Guardando...';

                // Usamos la variable global 'currentUser' para obtener el nombre de usuario
                const username = currentUser.username;

                socket.emit('user:changePassword', { username, currentPassword, newPassword });
            };

            // Asignar eventos a los botones
            btnChangePassword.addEventListener('click', openChangePasswordModal);
            btnCancel.addEventListener('click', closeChangePasswordModal);
            btnConfirm.addEventListener('click', submitPasswordChange);

            // Listener para la respuesta del servidor
            socket.on('user:changePasswordResponse', (response) => {
                btnConfirm.disabled = false;
                btnConfirm.textContent = 'Guardar Cambios';

                if (response.success) {
                    successDiv.textContent = response.message;
                    successDiv.style.display = 'block';
                    setTimeout(closeChangePasswordModal, 2500); // Cierra el modal tras el éxito
                } else {
                    errorDiv.textContent = response.message;
                    errorDiv.style.display = 'block';
                }
            });
        }
        // ▲▲▲ FIN DEL BLOQUE DE CÓDIGO ▲▲▲
    })();
})();
// --- FIN: SCRIPT DEL LOBBY ---


// --- INICIO: SCRIPT DEL JUEGO ---
(function() {

    socket.on('chatHistory', (history) => {
        console.log('Recibiendo historial del chat con', history.length, 'mensajes.');
        const messagesInner = document.getElementById('chat-messages-inner');
        if (messagesInner) {
            messagesInner.innerHTML = ''; // Limpiamos la vista actual
            // Llenamos el chat con el historial recibido
            history.forEach(msg => {
                const role = msg.sender === 'Sistema' ? 'system' : 'player';
                addChatMessage(msg.sender, msg.message, role);
            });
        }
    });

    socket.on('oponenteDescarto', (data) => {
        console.log(`El oponente (${data.playerId}) descartó la carta:`, data.card);
        discardPile.push(data.card);
        renderDiscard();
    });

    socket.on('playerSatDownToWait', (data) => {
        console.log('Un jugador se ha sentado para esperar. Actualizando vista de jugadores.');
        
        const newSeats = data.seats;
        updatePlayersView(newSeats, true); 


        showToast(`${data.waitingPlayerName} se sentará en la próxima partida.`, 3000);
    });

    socket.on('seatBecameAvailable', (data) => {
        // Solo reaccionamos si somos espectadores con intención de jugar.
        const isSpectator = !orderedSeats.some(s => s && s.playerId === socket.id);
        if (!isSpectator || spectatorMode !== 'wantsToPlay') {
            return;
        }

        // Comprobación de créditos
        const roomSettings = currentGameSettings.settings;
        const requiredCredits = (roomSettings.bet || 0) + (roomSettings.penalty || 0);
        const userCredits = currentUser.credits ?? parseInt(localStorage.getItem('userCredits')) ?? 1000; // MIGRACIÓN SEGURA

        if (userCredits < requiredCredits) {
            showToast(`Un asiento está libre, pero necesitas ${requiredCredits} créditos para unirte.`, 4000);
            return;
        }

        // Mostrar el modal de confirmación
        const modal = document.getElementById('sit-request-modal');
        const btnConfirm = document.getElementById('btn-confirm-sit');
        const btnDecline = document.getElementById('btn-decline-sit');

        btnConfirm.onclick = () => {
            socket.emit('requestToSit', data.roomId);
            modal.style.display = 'none';
        };
        btnDecline.onclick = () => {
            // El jugador elige no sentarse. Cambiamos su modo para no volver a preguntarle.
            spectatorMode = 'spectateOnly';
            showToast('De acuerdo, seguirás solo como espectador.', 3000);
            modal.style.display = 'none';
        };
        
        modal.style.display = 'flex';
    });

    // Versión definitiva de 'turnChanged'
    socket.on('turnChanged', async (data) => {
        console.log('Server broadcast: El turno ha cambiado.', data);

        isWaitingForNextTurn = false;

        // --- 1. Animación de descarte de oponentes (SIN CAMBIOS) ---
        if (data.discardingPlayerId && data.discardingPlayerId !== socket.id && data.discardedCard) {
            const playerViewIndex = orderedSeats.findIndex(s => s && s.playerId === data.discardingPlayerId);
            if (playerViewIndex !== -1) {
                const startElement = document.getElementById(`info-player${playerViewIndex}`);
                const endElement = document.getElementById('discard');
                if (startElement && endElement) {
                    animateCardMovement({
                        cardsData: [data.discardedCard],
                        startElement,
                        endElement,
                        isBack: false,
                        duration: 900
                    });
                }
            }
        }

        // --- INICIO DE LA CORRECCIÓN CLAVE ---

        // 1. Guardamos el número de juegos ANTES de actualizar los datos.
        const oldMeldCount = allMelds.length;

        // 2. Actualizamos los datos del juego como siempre.
        allMelds = data.newMelds || [];
        turnMelds = []; // Se resetean los melds temporales, restaurando la lógica.
        discardPile = data.newDiscardPile;

        // 3. LA CONDICIÓN: Comparamos si el número de juegos cambió.
        //    Esto solo será 'true' si un jugador acaba de bajar un nuevo conjunto.
        const meldsHaveChanged = allMelds.length !== oldMeldCount;

        // --- FIN DE LA CORRECCIÓN CLAVE ---

        // --- 3. LÓGICA DE "BISTURÍ": Si el descarte fue mío, eliminamos SOLO esa carta. ---
        const humanPlayer = players[0];
        if (data.discardingPlayerId === socket.id && humanPlayer && data.discardedCard) {
            
            // ▼▼▼ OCULTAR MENSAJE DEL PRIMER TURNO AL CONFIRMAR EL DESCARTE ▼▼▼
            // Si es el primer descarte, ocultar el toast definitivamente
            if (isFirstDiscard) {
                const toast = document.getElementById('toast');
                if (toast) {
                    const toastText = toast.textContent || '';
                    if (toastText.includes('primer turno') || toastText.includes('15 cartas') || toast.classList.contains('first-turn')) {
                        // Ocultar completamente el toast del primer turno
                        toast.classList.remove('show');
                        toast.classList.remove('first-turn');
                        toast.style.display = 'none';
                        toast.style.opacity = '0';
                        toast.style.visibility = 'hidden';
                        toast.style.top = 'auto';
                        toast.style.bottom = '26px';
                        toast.style.transform = 'translateX(-50%)';
                        toast.textContent = '';
                        console.log('[Cliente] ✅ Mensaje del primer turno ocultado al confirmar el descarte');
                    }
                }
                // Limpiar el timeout si existe
                if (firstTurnToastTimeout) {
                    clearTimeout(firstTurnToastTimeout);
                    firstTurnToastTimeout = null;
                }
                isFirstDiscard = false;
            }
            // ▲▲▲ FIN DE OCULTAR MENSAJE DEL PRIMER TURNO ▲▲▲

            // a) Actualizamos el array de datos interno.
            const cardIndexInHand = humanPlayer.hand.findIndex(c => c.id === data.discardedCard.id);
            if (cardIndexInHand !== -1) {
                humanPlayer.hand.splice(cardIndexInHand, 1);
            }
            selectedCards.clear();

            // b) Actualizamos la VISTA de forma precisa, sin redibujar todo.
            const cardElementToRemove = document.querySelector(`#human-hand .card[data-card-id='${data.discardedCard.id}']`);
            if (cardElementToRemove) {
                cardElementToRemove.remove(); // Eliminamos solo el elemento de la carta.
                // Re-indexamos las cartas restantes para que el drag-and-drop no se rompa.
                const remainingCards = document.querySelectorAll('#human-hand .card');
                remainingCards.forEach((card, index) => {
                    card.dataset.index = index;
                });
            }
        }

        // --- 4. Lógica para avanzar el turno y contadores (SIN CAMBIOS) ---
        const newCurrentPlayerIndex = orderedSeats.findIndex(s => s && s.playerId === data.nextPlayerId);
        if (newCurrentPlayerIndex !== -1) {
            currentPlayer = newCurrentPlayerIndex;
        }

        hasDrawn = false;
        mustDiscard = false;

        if (data.playerHandCounts) {
            updatePlayerHandCounts(data.playerHandCounts);
        }

        // --- 5. SOLUCIÓN ANTI-PARPADEO PRECISA Y CONDICIONAL ---
        const discardEl = document.getElementById('discard');
        const meldsContainer = document.getElementById('melds-display');

        // Hacemos invisibles las zonas que se van a redibujar.
        // La zona de juegos solo se hará invisible SI HA CAMBIADO.
        if (discardEl) discardEl.classList.add('updating');
        if (meldsContainer && meldsHaveChanged) {
            meldsContainer.classList.add('updating');
        }

        // Esperamos un instante para que la animación de CSS termine.
        await new Promise(r => setTimeout(r, 150));

        // Redibujamos SOLO lo necesario.
        renderDiscard();
        if (meldsHaveChanged) {
            renderMelds(); // <-- Esta llamada ahora solo ocurre cuando es necesario.
        }

        // Las volvemos a hacer visibles para una aparición suave.
        if (discardEl) discardEl.classList.remove('updating');
        if (meldsContainer && meldsHaveChanged) {
            meldsContainer.classList.remove('updating');
        }
        // --- FIN DE LA SOLUCIÓN ANTI-PARPADEO ---

        // --- 6. Actualizamos el resto de la UI que no causa parpadeo (SIN CAMBIOS) ---
        updateTurnIndicator();
        updateActionButtons();

        const newCurrentPlayerSeat = orderedSeats[currentPlayer];
        if (newCurrentPlayerSeat) {
            if (newCurrentPlayerSeat.playerId === socket.id) {
                playSound('turn'); // <--- AÑADE ESTA LÍNEA
                // Mensaje eliminado: "¡Es tu turno!"
            } else {
                // Mensaje eliminado: "Turno de X jugador"
            }
        }
    });

    // ▼▼▼ REEMPLAZA socket.on('cardDrawn', ...) CON ESTO ▼▼▼
    socket.on('cardDrawn', async (data) => {
        playSound('draw'); // <--- AÑADE ESTA LÍNEA
        console.log("Carta recibida del servidor:", data.card);
        const p = players[0];
        if (!p) return;

        discardPile = data.newDiscardPile;

        const deckEl = document.getElementById('deck');
        const handEl = document.getElementById('human-hand');

        // 1. La animación se ejecuta y esperamos a que termine.
        await animateCardMovement({
            cardsData: [data.card],
            startElement: deckEl,
            endElement: handEl,
            isBack: true
        });

        // --- INICIO DE LA LÓGICA DE "BISTURÍ" ---
        // 2. Creamos SOLO la nueva carta en el DOM.
        const newCardElement = createCardElement(data.card, p.hand.length); // Le pasamos el nuevo índice

        // 3. La añadimos al final de la mano.
        handEl.appendChild(newCardElement);

        // 4. Actualizamos el array de datos interno.
        p.hand.push(data.card);
        // --- FIN DE LA LÓGICA DE "BISTURÍ" ---

        hasDrawn = true;
        isDrawing = false;
        drewFromDiscard = false;

        renderDiscard(); // Esto sí es necesario
        updateActionButtons();
        // Mensaje eliminado: "Has robado del mazo."
    });
    // ▲▲▲ FIN DEL PRIMER REEMPLAZO ▲▲▲

    // ▼▼▼ REEMPLAZA socket.on('discardCardDrawn', ...) CON ESTO ▼▼▼
    socket.on('discardCardDrawn', async (data) => {
        playSound('draw'); // <--- AÑADE ESTA LÍNEA
        console.log("Carta del descarte recibida del servidor:", data.card);
        const p = players[0];
        if (!p) return;

        const discardEl = document.getElementById('discard');
        const handEl = document.getElementById('human-hand');

        if (discardEl && handEl) {
            await animateCardMovement({ cardsData: [data.card], startElement: discardEl, endElement: handEl });
        }

        // --- INICIO DE LA LÓGICA DE "BISTURÍ" ---
        // 1. Creamos SOLO la nueva carta en el DOM.
        const newCardElement = createCardElement(data.card, p.hand.length);

        // 2. La añadimos al final de la mano.
        handEl.appendChild(newCardElement);

        // 3. Actualizamos el array de datos y el estado del descarte.
        p.hand.push(data.card);
        discardPile = data.newDiscardPile;
        // --- FIN DE LA LÓGICA DE "BISTURÍ" ---

        hasDrawn = true;
        isDrawing = false;
        drewFromDiscard = true;
        discardCardUsed = data.card;

        renderDiscard();
        updateActionButtons();
        // Mensaje eliminado: "Has robado del descarte. Debes usar esta carta."
    });
    // ▲▲▲ FIN DEL SEGUNDO REEMPLAZO ▲▲▲

    socket.on('handUpdate', (newHand) => {
        const p = players[0];
        if (p) {
            p.hand = newHand;
            selectedCards.clear();
            showToast("Tus combinaciones han sido devueltas a tu mano.", 3500);
            renderHands();
        }
    });

    // ▼▼▼ ASEGÚRATE DE QUE socket.on('meldUpdate', ...) TENGA ESTE CÓDIGO ▼▼▼
    socket.on('meldUpdate', async (data) => {
        console.log("Actualización de jugada recibida del servidor:", data);

        allMelds = data.newMelds || [];
        turnMelds = data.turnMelds || [];

        if (data.playerHandCounts) {
            updatePlayerHandCounts(data.playerHandCounts);
        }

        if (isAnimatingLocalMeld) {
            console.log("Ignorando renderizado de 'meldUpdate' por animación local en curso.");
            return;
        }

        const meldsContainer = document.getElementById('melds-display');
        if (meldsContainer) {
            // Hacemos que la zona de juegos se desvanezca usando la clase CSS.
            meldsContainer.classList.add('updating');

            // Esperamos un instante a que la animación de fade-out termine.
            await new Promise(r => setTimeout(r, 150));

            // Redibujamos los conjuntos MIENTRAS están invisibles.
            renderMelds();

            // La volvemos a hacer visible.
            meldsContainer.classList.remove('updating');
        }

        if (data.highlight) {
            const { cardId, meldIndex } = data.highlight;
            const meldGroupEl = document.querySelector(`.meld-group[data-meld-index='${meldIndex}']`);
            if (meldGroupEl) {
                const cardEl = meldGroupEl.querySelector(`.card[data-card-id='${cardId}']`);
                if (cardEl) {
                    cardEl.classList.add('highlight-add');
                    setTimeout(() => {
                        cardEl.classList.remove('highlight-add');
                    }, 4000);
                }
            }
        }
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    // ▼▼▼ LISTENER PARA TIMEOUT DE INACTIVIDAD (MOSTRAR MODAL EN EL LOBBY) ▼▼▼
    socket.on('inactivityTimeout', (data) => {
        console.log('[inactivityTimeout] Jugador eliminado por inactividad:', data);
        
        // Preservar datos del usuario antes de redirigir
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
            currentUser.userId = userId;
        }
        if (username) {
            sessionStorage.setItem('username', username);
            localStorage.setItem('username', username);
            currentUser.username = username;
            
            // ▼▼▼ CRÍTICO: Actualizar el nombre en la UI inmediatamente ▼▼▼
            const userNameEl = document.getElementById('user-name');
            if (userNameEl) {
                userNameEl.textContent = username;
                console.log('[inactivityTimeout] ✅ Nombre actualizado en UI:', username);
            }
            // ▲▲▲ FIN DE ACTUALIZACIÓN DE UI ▲▲▲
        }
        if (userAvatar) {
            sessionStorage.setItem('userAvatar', userAvatar);
            localStorage.setItem('userAvatar', userAvatar);
            currentUser.userAvatar = userAvatar;
            
            // Actualizar el avatar en la UI
            const userAvatarEl = document.getElementById('user-avatar');
            if (userAvatarEl) {
                userAvatarEl.src = userAvatar;
            }
        }
        if (userCurrency) {
            sessionStorage.setItem('userCurrency', userCurrency);
            localStorage.setItem('userCurrency', userCurrency);
            currentUser.currency = userCurrency;
        }
        
        // ▼▼▼ CRÍTICO: NO limpiar estado del juego ni emitir leaveGame - el servidor ya maneja la eliminación ▼▼▼
        // El servidor ya eliminó al jugador de la sala, solo necesitamos mostrar el modal
        // NO emitir leaveGame - esto causaría desconexión prematura
        // NO limpiar currentGameSettings - el servidor ya lo hizo
        // NO ocultar la vista del juego - el jugador ya fue eliminado por el servidor
        
        // Solo asegurar que el lobby overlay esté visible si no está en el lobby
        const lobbyOverlay = document.getElementById('lobby-overlay');
        if (lobbyOverlay && lobbyOverlay.style.display !== 'flex') {
            lobbyOverlay.style.display = 'flex';
        }
        
        // Si no está en el lobby, mostrar el lobby
        if (!document.body.classList.contains('lobby-active')) {
            showLobbyView();
        }
        // ▲▲▲ FIN: NO HACER NADA QUE CAUSE DESCONEXIÓN ▲▲▲
        
        // ▼▼▼ SOLICITAR ACTUALIZACIÓN INMEDIATA DE LISTA DE USUARIOS ▼▼▼
        // Asegurar que el servidor actualice el estado del usuario y la lista
        socket.emit('enterLa51Lobby');
        socket.emit('requestInitialData');
        console.log('[inactivityTimeout] ✅ Solicitud de actualización de lista de usuarios enviada');
        // ▲▲▲ FIN DE SOLICITUD DE ACTUALIZACIÓN ▲▲▲
        
        // ▼▼▼ MOSTRAR MODAL DE INACTIVIDAD EN EL LOBBY ▼▼▼
        // Buscar o crear modal de inactividad
        let inactivityModal = document.getElementById('inactivity-timeout-modal');
        if (!inactivityModal) {
            // Crear el modal si no existe
            inactivityModal = document.createElement('div');
            inactivityModal.id = 'inactivity-timeout-modal';
            inactivityModal.className = 'modal-overlay';
            inactivityModal.innerHTML = `
                <div class="modal-content" style="max-width: 500px; border: 3px solid #ff9800; background: var(--casino-dark-panel);">
                    <h2 style="color: #ff9800; margin-bottom: 20px;">¡ELIMINADO POR INACTIVIDAD!</h2>
                    <div class="content" style="padding: 20px;">
                        <p id="inactivity-message" style="font-size: 1.1rem; line-height: 1.6; margin: 15px 0; color: #fff;"></p>
                    </div>
                    <div style="text-align: center; margin-top: 20px;">
                        <button id="btn-accept-inactivity" class="button orange" style="padding: 10px 30px;">Aceptar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(inactivityModal);
        }
        
        // Configurar el mensaje
        const messageEl = document.getElementById('inactivity-message');
        if (messageEl) {
            messageEl.textContent = data.message || 'Has sido eliminado de la mesa por falta de inactividad por 2 minutos.';
        }
        
        // Mostrar el modal
        inactivityModal.style.display = 'flex';
        inactivityModal.style.zIndex = '10000';
        
        // Configurar el botón de aceptar
        const acceptBtn = document.getElementById('btn-accept-inactivity');
        if (acceptBtn) {
            acceptBtn.onclick = () => {
                inactivityModal.style.display = 'none';
                // Solicitar actualización de la lista de usuarios y estado
                socket.emit('enterLa51Lobby');
                socket.emit('requestInitialData');
            };
        }
        
        // También cerrar el modal con clic fuera
        inactivityModal.onclick = (e) => {
            if (e.target === inactivityModal) {
                inactivityModal.style.display = 'none';
                // Solicitar actualización de la lista de usuarios y estado
                socket.emit('enterLa51Lobby');
                socket.emit('requestInitialData');
            }
        };
        // ▲▲▲ FIN MODAL DE INACTIVIDAD ▲▲▲
        
        // Solicitar actualización de la lista de usuarios y estado del usuario
        socket.emit('enterLa51Lobby');
        socket.emit('requestInitialData');
    });
    // ▲▲▲ FIN LISTENER PARA TIMEOUT DE INACTIVIDAD ▲▲▲

    // Reemplaza el listener socket.on('playerEliminated',...)
    socket.on('playerEliminated', (data) => {
        console.log('[playerEliminated] Evento recibido:', data);
        console.log('[playerEliminated] socket.id actual:', socket.id);
        console.log('[playerEliminated] data.playerId:', data.playerId);
        console.log('[playerEliminated] data.redirect:', data.redirect);

        // ▼▼▼ CRÍTICO: MANEJAR ELIMINACIONES DE MESAS DE PRÁCTICA ESPECIALMENTE ▼▼▼
        // En práctica, se debe mostrar el modal de falta pero NO redirigir al lobby
        const isPracticeGame = currentGameSettings && currentGameSettings.isPractice;
        if (isPracticeGame) {
            console.log('[playerEliminated] Eliminación en mesa de práctica detectada. Mostrando modal de falta.');
            // NO retornar aquí, continuar para mostrar el modal de falta
        }
        // ▲▲▲ FIN DE VERIFICACIÓN DE MESA DE PRÁCTICA ▲▲▲

        // --- INICIO DE LA CORRECCIÓN ---
        // Normalizamos el objeto de falta para que siempre tenga la misma estructura.
        let faultInfo = data.faultData;
        if (!faultInfo && data.reason) {
            // Si 'faultData' no existe pero 'reason' sí (caso de abandono),
            // creamos el objeto que la función espera.
            faultInfo = { reason: data.reason };
        }
        // --- FIN DE LA CORRECCIÓN ---

        // ▼▼▼ VERIFICAR SI EL JUGADOR ELIMINADO ES EL USUARIO ACTUAL ▼▼▼
        // CRÍTICO: Si redirect es true, SIEMPRE procesar como eliminación por inactividad
        // Esto asegura que funcione incluso si el socket.id cambió después de reconexión
        const isCurrentPlayer = data.playerId === socket.id;
        const isInactivityAbandonment = data.redirect === true;
        
        console.log('[playerEliminated] isCurrentPlayer (por socket.id):', isCurrentPlayer);
        console.log('[playerEliminated] isInactivityAbandonment (redirect === true):', isInactivityAbandonment);
        
        // ▼▼▼ CRÍTICO: Procesar si es el jugador actual O si es abandono por inactividad ▼▼▼
        if (isCurrentPlayer || isInactivityAbandonment) {
            console.log('⚠️ El jugador actual fue eliminado. Verificando tipo de eliminación...');
            
            // ▼▼▼ CRÍTICO: Verificar el flag redirect PRIMERO antes de limpiar el estado ▼▼▼
            // Verificar el flag redirect para decidir si redirigir al lobby
            const shouldRedirect = data.redirect === true; // Solo true si es explícitamente true (abandono por inactividad)
            
            if (shouldRedirect) {
                // ▼▼▼ CASO: ABANDONO POR INACTIVIDAD - El servidor ya eliminó al jugador, solo mostrar modal ▼▼▼
                console.log('⚠️ El jugador actual fue eliminado por ABANDONO POR INACTIVIDAD. El servidor ya lo eliminó, solo mostrando modal...');
                
                // ▼▼▼ CRÍTICO: NO limpiar estado del juego ni emitir leaveGame - el servidor ya maneja la eliminación ▼▼▼
                // NO emitir leaveGame - esto causaría desconexión prematura
                // NO limpiar currentGameSettings - el servidor ya lo hizo
                // NO ocultar la vista del juego - el servidor ya eliminó al jugador
                
                // Solo asegurar que el lobby overlay esté visible si no está en el lobby
                const lobbyOverlay = document.getElementById('lobby-overlay');
                if (lobbyOverlay && lobbyOverlay.style.display !== 'flex') {
                    lobbyOverlay.style.display = 'flex';
                }
                
                // Si no está en el lobby, mostrar el lobby
                if (!document.body.classList.contains('lobby-active')) {
                    showLobbyView();
                }
                // ▲▲▲ FIN: NO HACER NADA QUE CAUSE DESCONEXIÓN ▲▲▲
                
                // Mostrar mensaje de eliminación
                showEliminationMessage(data.playerName, faultInfo);
                
                // NO marcar shouldRedirectToLobbyAfterElimination - el servidor ya eliminó al jugador
                shouldRedirectToLobbyAfterElimination = false;
                
                // ▼▼▼ DETECTAR TIPO DE JUEGO ACTUAL PARA REDIRIGIR AL LOBBY CORRECTO ▼▼▼
                // Detectar el tipo de juego basándose en la URL actual
                const currentPath = window.location.pathname;
                if (currentPath.includes('/ludo/') || currentPath.includes('/parchis/')) {
                    eliminationGameType = 'ludo'; // Ludo o Parchís
                    console.log('[playerEliminated] Jugador estaba jugando Ludo/Parchís, se redirigirá al lobby de Ludo');
                } else {
                    eliminationGameType = 'la51'; // La 51 (por defecto)
                    console.log('[playerEliminated] Jugador estaba jugando La 51, se redirigirá al lobby de La 51');
                }
                // ▲▲▲ FIN DE DETECCIÓN DE TIPO DE JUEGO ▲▲▲
            } else {
                // ▼▼▼ CASO: FALTA DE JUEGO - NO limpiar estado, solo mostrar modal ▼▼▼
                console.log('⚠️ El jugador actual fue eliminado por FALTA DE JUEGO. Mostrando modal pero NO expulsando (redirect: false)');
                
                // NO limpiar el estado del juego
                // NO ocultar la vista del juego
                // NO emitir leaveGame
                // Solo mostrar el mensaje de eliminación
                showEliminationMessage(data.playerName, faultInfo);
                
                // NO redirigir, el jugador puede seguir viendo el resto del juego
                // EXCEPTO en práctica, donde se mostrará el modal de reinicio después
                shouldRedirectToLobbyAfterElimination = false;
                eliminationGameType = null;
                
                // Si es práctica, la bandera practiceGameEndedByHumanFault ya fue activada por el evento practiceGameHumanFaultEnd
                // y se mostrará el modal de reinicio cuando se cierre el modal de falta
            }
            // ▲▲▲ FIN DE VERIFICACIÓN DE TIPO DE ELIMINACIÓN ▲▲▲
            
            return; // Salir temprano para no procesar más
        }
        // ▲▲▲ FIN VERIFICACIÓN JUGADOR ACTUAL ▲▲▲

        showEliminationMessage(data.playerName, faultInfo); // Ahora 'faultInfo' nunca será undefined

        const playerViewIndex = orderedSeats.findIndex(s => s && s.playerId === data.playerId);
        if (playerViewIndex !== -1) {
            const p = players[playerViewIndex];
            if (p) {
                p.active = false;
                p.hand = [];
            }
            const infoBotEl = document.getElementById(`info-player${playerViewIndex}`);
            if (infoBotEl) {
                const counterEl = infoBotEl.querySelector('.card-counter');
                if (counterEl) {
                    counterEl.textContent = '❌ Eliminado';
                }
            }
            if (playerViewIndex === 0) {
                const humanHandEl = document.getElementById('human-hand');
                if (humanHandEl) {
                    humanHandEl.innerHTML = '';
                }
            }
        }
    });

    // ▼▼▼ REEMPLAZA TU LISTENER socket.on('gameEnd', ...) CON ESTE ▼▼▼
    socket.on('gameEnd', (data) => {
        console.log('PARTIDA FINALIZADA.', data);

        resetClientGameState(); 

        if (data.finalRoomState) {
            updatePlayersView(data.finalRoomState.seats, true); 
        }

        const wasPlayerInGame = data.finalRoomState.seats.some(s => s && s.playerId === socket.id);

        const victoryOverlay = document.getElementById('victory-overlay');
        const victoryMessage = document.getElementById('victory-message');
        const finalScores = document.getElementById('final-scores');
        const setupRematchBtn = document.getElementById('btn-setup-rematch');

        let headerText = `¡${data.winnerName} ha ganado la partida!`;
        if (data.abandonment && data.abandonment.name) {
            headerText += `<br><span style="font-size: 0.9rem; color: #ffdddd;">(Por abandono de ${data.abandonment.name})</span>`;
        }
        victoryMessage.innerHTML = headerText;

        // --- INICIO DE LA LÓGICA DE EQUIVALENCIA ---
        let finalHTML = data.scoresHTML || '<p>No hay detalles de la partida.</p>';

        if (data.potData && currentUser.currency && data.potData.currency !== currentUser.currency) {
            const potInfo = data.potData;
            const convertedPot = convertCurrency(potInfo.pot, potInfo.currency, currentUser.currency, clientExchangeRates);
            const convertedCommission = convertCurrency(potInfo.commission, potInfo.currency, currentUser.currency, clientExchangeRates);
            const convertedWinnings = convertCurrency(potInfo.winnings, potInfo.currency, currentUser.currency, clientExchangeRates);
            const symbol = currentUser.currency === 'EUR' ? '€' : currentUser.currency;

            const equivalencyHTML = `
                <div style="border-top: 1px solid #555; margin-top: 15px; padding-top: 10px; text-align: left; font-size: 0.9rem; color: #aaa;">
                    <p><strong>Equivalencia en tu moneda (${symbol}):</strong></p>
                    <p>Bote Total: ~${convertedPot.toFixed(2)} ${symbol}</p>
                    <p>Comisión: ~${convertedCommission.toFixed(2)} ${symbol}</p>
                    <p style="color: #6bff6b; font-weight: bold;">Ganancia: ~${convertedWinnings.toFixed(2)} ${symbol}</p>
                </div>
            `;
            finalHTML += equivalencyHTML;
        }

        finalScores.innerHTML = finalHTML;
        // --- FIN DE LA LÓGICA DE EQUIVALENCIA ---

        if (wasPlayerInGame) {
            setupRematchBtn.style.display = 'inline-block';
            setupRematchBtn.onclick = setupRematchScreen;
        } else {
             setupRematchBtn.style.display = 'none';
        }

        showOverlay('victory-overlay');
    });
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    socket.on('handCountsUpdate', (data) => {
        console.log('Actualización de contadores recibida:', data);
        if (data.playerHandCounts) {
            updatePlayerHandCounts(data.playerHandCounts);
        }
    });

    socket.on('gameChat', (data) => {
        const chatWindow = document.getElementById('chat-window');
        const badge = document.getElementById('chat-notification-badge');
        
        // Si el chat no está visible, incrementa el contador
        if (chatWindow && !chatWindow.classList.contains('visible')) {
            playSound('notify'); // <--- AÑADE ESTA LÍNEA
            unreadMessages++;
            badge.textContent = unreadMessages;
            badge.style.display = 'flex';
        }
        addChatMessage(data.sender, data.message, 'player');
    });

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER ▼▼▼
    socket.on('playSound', (soundId) => {
        playSound(soundId);
    });
    // ▲▲▲ FIN DEL LISTENER ▲▲▲

    // ▼▼▼ LISTENERS PARA MANEJAR JUGADORES QUE NO CONFIRMARON A TIEMPO ▼▼▼
    socket.on('rematchGameStartedWithoutYou', (data) => {
        console.log('[Cliente] La revancha comenzó sin tu confirmación:', data);
        showToast(data.message || 'La revancha ya comenzó sin tu confirmación. Serás redirigido al lobby.', 5000);
        if (data.redirectToLobby) {
            setTimeout(() => {
                console.log('🔌 [CLIENTE DEBUG] rematchGameStartedWithoutYou - limpiando estado');
                resetClientGameState();
                // ▼▼▼ CRÍTICO: Solo emitir leaveGame si el juego NO está activo ▼▼▼
                // Si el juego ya comenzó, el servidor ya procesó la salida
                const isGameActive = currentGameSettings && currentGameSettings.roomId && 
                                    document.body.classList.contains('game-active');
                if (currentGameSettings && currentGameSettings.roomId && !isGameActive) {
                    socket.emit('leaveGame', { roomId: currentGameSettings.roomId });
                }
                currentGameSettings = null;
                showLobbyView();
                socket.emit('enterLa51Lobby');
            }, 3000);
        }
    });

    socket.on('rematchGameAlreadyStarted', (data) => {
        console.log('[Cliente] Intento de confirmar revancha pero el juego ya comenzó:', data);
        showToast(data.message || 'La revancha ya comenzó. No puedes confirmar ahora. Serás redirigido al lobby.', 5000);
        if (data.redirectToLobby) {
            setTimeout(() => {
                console.log('🔌 [CLIENTE DEBUG] rematchGameAlreadyStarted - limpiando estado');
                resetClientGameState();
                // ▼▼▼ CRÍTICO: Solo emitir leaveGame si el juego NO está activo ▼▼▼
                // Si el juego ya comenzó, el servidor ya procesó la salida
                const isGameActive = currentGameSettings && currentGameSettings.roomId && 
                                    document.body.classList.contains('game-active');
                if (currentGameSettings && currentGameSettings.roomId && !isGameActive) {
                    socket.emit('leaveGame', { roomId: currentGameSettings.roomId });
                }
                currentGameSettings = null;
                showLobbyView();
                socket.emit('enterLa51Lobby');
            }, 3000);
        }
    });
    // ▲▲▲ FIN DE LISTENERS ▲▲▲

    socket.on('rematchUpdate', (data) => {
        const statusEl = document.getElementById('rematch-status');
        if (statusEl) {
            statusEl.innerHTML = `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555;">
                                      <strong>Jugadores listos:</strong> ${data.playersReady.join(', ')}
                                   </div>`;
        }
        addChatMessage(null, `Jugadores listos: ${data.playersReady.join(', ')}`, 'system');

        // Lógica para mostrar/ocultar el botón de inicio
        const startButton = document.getElementById('btn-start-rematch');
        // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
        const mainButton = document.getElementById('btn-ready-main');

        // El botón solo aparece si: se puede iniciar, el jugador es el host Y YA HA CONFIRMADO
        if (data.canStart && socket.id === data.hostId && mainButton.disabled) {
            startButton.style.display = 'block';
            startButton.disabled = false; // <-- AÑADE ESTA LÍNEA AQUÍ
            // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
            mainButton.style.display = 'none'; // Ocultamos el botón de "Esperando..."

            startButton.onclick = () => {
                startButton.disabled = true; // Evitar doble clic
                socket.emit('startRematch', currentGameSettings.roomId);
            };
        } else {
            startButton.style.display = 'none';
        }
    });

    socket.on('rematchFailed', (data) => {
        showToast(data.reason, 4000);
        const btn = document.getElementById('victory-overlay').querySelector('button.new-game-btn');
        if (btn) {
            btn.textContent = 'No puedes continuar';
            btn.disabled = true;
        }
    });

    socket.on('meldSuccess', (data) => {
        const p = players[0]; // El jugador humano
        if (p && data.meldedCardIds) {
            // Elimina las cartas confirmadas por el servidor de la mano local
            p.hand = p.hand.filter(card => !data.meldedCardIds.includes(card.id));
            selectedCards.clear();
            
            // Si el servidor confirmó que se bajó un conjunto, el jugador ya cumplió los 51 puntos
            if (!p.doneFirstMeld) {
                p.doneFirstMeld = true;
            }
            
            renderHands(); // Vuelve a renderizar la mano ya actualizada
        }
    });

    socket.on('fault', (data) => {
        // Muestra el motivo del error enviado por el servidor
        showToast(`❌ Jugada inválida: ${data.reason}`, 4000);
        // Deseleccionamos las cartas para que el jugador pueda intentar otra jugada
        selectedCards.clear();
        renderHands();
    });


    socket.on('kickedFromRoom', (data) => {
        showToast(data.reason, 5000);
        goBackToLobby();
    });

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER COMPLETO ▼▼▼
    socket.on('newHostAssigned', (data) => {
        if (currentGameSettings) {
            currentGameSettings.hostId = data.hostId;
        }
        showToast(`${data.hostName} es ahora el nuevo anfitrión.`, 3500);

        // Ya no es necesario que el cliente pida una actualización,
        // el servidor la enviará automáticamente gracias al cambio en el Paso 1.

        renderGameControls();
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    socket.on('playerDrewCard', (data) => {
        // No animar para mí, mi propia acción ya tiene una animación local
        if (data.playerId === socket.id) return;

        const playerViewIndex = orderedSeats.findIndex(s => s && s.playerId === data.playerId);
        if (playerViewIndex === -1) return;

        const startElement = document.getElementById(data.source); // 'deck' o 'discard'
        const endElement = document.getElementById(`info-player${playerViewIndex}`);

        if (startElement && endElement) {
            if (data.source === 'deck') {
                animateCardMovement({ startElement, endElement, isBack: true, duration: 900 }); // <-- CAMBIA 600 POR 900
            } else {
                // Para el descarte, animamos la carta específica
                animateCardMovement({ cardsData: [data.card], startElement, endElement, isBack: false, duration: 900 }); // <-- CAMBIA 600 POR 900
            }
        }

        // Actualizar el estado del descarte para todos los jugadores
        if (data.source === 'discard' && data.newDiscardPile) {
            discardPile = data.newDiscardPile;
            renderDiscard(); // Actualizar la vista del descarte
        }

        // Actualizar los conteos de cartas (tanto para robar del mazo como del descarte)
        if (data.playerHandCounts) {
            updatePlayerHandCounts(data.playerHandCounts);
        }
    });

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER COMPLETO ▼▼▼
    socket.on('deckShuffled', () => {
        playSound('shuffle'); // <--- AÑADE ESTA LÍNEA
        const deckEl = document.getElementById('deck');

        // 1. Bloqueamos el mazo inmediatamente
        if (deckEl) {
            deckEl.classList.add('deck-shuffling');
        }

        // 2. Ejecutamos la animación de barajado como antes
        animateShuffle();

        // 3. Programamos el desbloqueo para que ocurra exactamente
        //    cuando la animación termine (dura 5000ms).
        setTimeout(() => {
            if (deckEl) {
                deckEl.classList.remove('deck-shuffling');
            }
        }, 5000);
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    socket.on('animateNewMeld', (data) => {
        if (data.melderId === socket.id) return;
        const playerViewIndex = orderedSeats.findIndex(s => s && s.playerId === data.melderId);
        if (playerViewIndex === -1) return;

        const startElement = document.getElementById(`info-player${playerViewIndex}`);
        const meldsContainer = document.getElementById('melds-display');

        if (startElement && meldsContainer) {
            // 1. Creamos un marcador de posición invisible al final de la lista de juegos.
            const placeholder = document.createElement('div');
            placeholder.className = 'meld-group';
            placeholder.style.visibility = 'hidden';
            meldsContainer.appendChild(placeholder);

            // 2. Animamos las cartas hacia ese marcador de posición.
            animateCardMovement({
                cardsData: data.cards,
                startElement,
                endElement: placeholder, // El destino es el marcador
                duration: 1200
            }).then(() => {
                // 3. Una vez termina la animación, eliminamos el marcador.
                // El juego real se dibujará con el evento 'meldUpdate'.
                // ▼▼▼ REEMPLAZA ESTA LÍNEA... ▼▼▼
                // meldsContainer.removeChild(placeholder);
                // ▲▲▲ ...CON ESTE BLOQUE MÁS SEGURO ▼▼▼
                if (meldsContainer.contains(placeholder)) {
                    meldsContainer.removeChild(placeholder);
                }
                // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
            });
        }
    });

    // ▼▼▼ LISTENER PARA MENSAJE DEL PRIMER TURNO (REGISTRAR PRIMERO) ▼▼▼
    // IMPORTANTE: Registrar este listener ANTES de gameStarted para asegurar que esté listo
    // Eliminar listener anterior si existe para evitar duplicados
    socket.off('firstTurnInfo');
    socket.on('firstTurnInfo', (data) => {
        console.log('[Cliente] ✅ Recibido firstTurnInfo:', data);
        // Mostrar SOLO el mensaje del primer turno (sin duplicados)
        if (data && data.message && data.message.includes('primer turno')) {
            // Limpiar cualquier timeout anterior
            if (firstTurnToastTimeout) {
                clearTimeout(firstTurnToastTimeout);
            }
            // Usar setTimeout para asegurar que el DOM esté listo
            firstTurnToastTimeout = setTimeout(() => {
                console.log('[Cliente] Mostrando toast con mensaje:', data.message);
                showToast(data.message, 10000, true); // Mostrar por 10 segundos, centrado en pantalla
                // También agregarlo al chat para referencia
                if (typeof addChatMessage === 'function') {
                    addChatMessage(null, data.message, 'system');
                }
                console.log('[Cliente] ✅ Mensaje mostrado en toast y chat');
                
                // Ocultar automáticamente después de 10 segundos
                setTimeout(() => {
                    const toast = document.getElementById('toast');
                    if (toast && toast.classList.contains('first-turn')) {
                        toast.classList.remove('show');
                        toast.classList.remove('first-turn');
                        toast.style.display = 'none';
                        toast.style.opacity = '0';
                        toast.style.visibility = 'hidden';
                        // Restaurar estilos por defecto
                        toast.style.top = 'auto';
                        toast.style.bottom = '26px';
                        toast.style.transform = 'translateX(-50%)';
                        console.log('[Cliente] ✅ Mensaje del primer turno ocultado automáticamente después de 10 segundos');
                    }
                }, 10000);
            }, 100);
        } else {
            console.log('[Cliente] Ignorando mensaje que no es del primer turno');
        }
    });
    console.log('[Cliente] ✅ Listener firstTurnInfo registrado');
    // ▲▲▲ FIN DEL LISTENER ▲▲▲

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER COMPLETO ▼▼▼
    socket.on('playerAbandoned', (data) => {
        // Mostramos una notificación visual a todos.
        showToast(data.message, 5000);
        // Y también lo registramos en el chat del juego.
        addChatMessage(null, data.message, 'system');
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // ▼▼▼ AÑADE ESTE LISTENER COMPLETO AQUÍ ▼▼▼
    socket.on('practiceGameHumanFaultEnd', () => {
        // Cuando el servidor confirma que la partida terminó por nuestra falta,
        // activamos la bandera.
        practiceGameEndedByHumanFault = true;
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // ▼▼▼ AÑADE ESTE LISTENER COMPLETO AQUÍ ▼▼▼
    // ▼▼▼ REEMPLAZA TUS LISTENERS 'practiceGameHumanWin' y 'practiceGameEnded' CON ESTOS DOS ▼▼▼

    socket.on('practiceGameHumanWin', () => {
        // Obtenemos los elementos del modal de victoria
        const victoryModal = document.getElementById('practice-victory-modal');
        const title = victoryModal.querySelector('h2');
        const message = victoryModal.querySelector('p');

        // Cambiamos el texto para la victoria del jugador
        title.textContent = '¡Victoria!';
        message.textContent = '¡Felicidades, has ganado la partida de práctica!';

        // Mostramos el modal ya actualizado
        showOverlay('practice-victory-modal');
    });

    socket.on('practiceGameBotWin', (data) => {
        // Obtenemos los mismos elementos del modal de victoria
        const victoryModal = document.getElementById('practice-victory-modal');
        const title = victoryModal.querySelector('h2');
        const message = victoryModal.querySelector('p');

        // Cambiamos el texto para mostrar qué bot ganó
        title.textContent = 'Partida Terminada';
        message.textContent = `El jugador ${data.winnerName} ha ganado la partida.`;

        // Mostramos el modal ya actualizado
        showOverlay('practice-victory-modal');
    });

    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲

    socket.on('animateCardAdd', (data) => {
        // No animar mi propia jugada, se anima localmente
        if (data.melderId === socket.id) return;

        const playerViewIndex = orderedSeats.findIndex(s => s && s.playerId === data.melderId);
        if (playerViewIndex === -1) return;

        const startElement = document.getElementById(`info-player${playerViewIndex}`);
        const endElement = document.querySelector(`.meld-group[data-meld-index='${data.targetMeldIndex}']`);

        if (startElement && endElement) {
            animateCardMovement({
                cardsData: [data.card],
                startElement,
                endElement,
                duration: 1000 // <-- CAMBIA 700 POR 1000
            }).then(() => {
                // Iluminar la combinación para todos
                endElement.classList.add('card-illuminated');
                setTimeout(() => {
                    endElement.classList.remove('card-illuminated');
                }, 2500); // La duración de la animación CSS
            });
        }
    });

    // currentGameSettings ya está declarado como variable global arriba
    // let currentGameSettings = {}; // ▼▼▼ ELIMINADO: Ya está declarado como variable global ▼▼▼
    let players = [];
    let gameStarted = false;
    let deck = [], discardPile = [], currentPlayer = 0, allMelds = [], turnMelds = []; // Añadir turnMelds
    let unreadMessages = 0;
    let isWaitingForNextTurn = false;
    let isAnimatingLocalMeld = false; // <<-- AÑADE ESTA LÍNEA
    // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
    let practiceGameEndedByHumanFault = false;
    // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
    let penaltyAmount, requiredMeld, hasDrawn, drewFromDiscard, discardCardUsed, mustDiscard, strictRules, drewFromDeckToWin, selectedCards, isDrawing;
    let firstTurnToastTimeout = null; // Variable para rastrear el timeout del toast del primer turno
    let isFirstDiscard = false; // Variable para rastrear si es el primer descarte del juego

    // ▼▼▼ PEGA EL BLOQUE COMPLETO AQUÍ ▼▼▼
    // Configuración de los botones del modal de reinicio de práctica (Ubicación corregida)
    document.addEventListener('DOMContentLoaded', () => {
        const btnRestart = document.getElementById('btn-restart-practice');
        const btnExit = document.getElementById('btn-exit-practice');

        if (btnRestart) {
            btnRestart.onclick = () => {
                hideOverlay('practice-restart-modal');
                hideOverlay('practice-victory-modal');
                
                // ▼▼▼ LIMPIAR COMPLETAMENTE EL ESTADO DEL JUEGO ANTES DE REINICIAR ▼▼▼
                console.log('[Práctica] Limpiando estado del juego anterior antes de reiniciar...');
                
                // 1. Resetear estado del cliente
                resetClientGameState();
                
                // 2. Limpiar variables de estado
                gameStarted = false;
                players = [];
                orderedSeats = [];
                allMelds = [];
                turnMelds = [];
                selectedCards = new Set();
                currentPlayer = 0;
                hasDrawn = false;
                drewFromDiscard = false;
                discardCardUsed = null;
                mustDiscard = false;
                drewFromDeckToWin = false;
                isDrawing = false;
                isWaitingForNextTurn = false;
                practiceGameEndedByHumanFault = false;
                
                // 3. Limpiar elementos visuales
                const humanHandEl = document.getElementById('human-hand');
                if (humanHandEl) humanHandEl.innerHTML = '';
                
                const meldsDisplayEl = document.getElementById('melds-display');
                if (meldsDisplayEl) meldsDisplayEl.innerHTML = '';
                
                const discardEl = document.getElementById('discard');
                if (discardEl) discardEl.innerHTML = 'Descarte<br>Vacío';
                
                // 4. Limpiar bote
                const potValueEl = document.querySelector('#game-pot-container .pot-value');
                if (potValueEl) potValueEl.textContent = '0';
                
                // 5. Limpiar información de jugadores
                for (let i = 0; i < 4; i++) {
                    const playerInfoEl = document.getElementById(`info-player${i}`);
                    if (playerInfoEl) {
                        playerInfoEl.classList.remove('current-turn-glow');
                        const playerNameEl = playerInfoEl.querySelector('.player-name');
                        const playerAvatarEl = playerInfoEl.querySelector('.player-avatar');
                        const playerCounterEl = playerInfoEl.querySelector('.card-counter');
                        if (playerNameEl) playerNameEl.textContent = "Asiento Vacío";
                        if (playerAvatarEl) playerAvatarEl.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                        if (playerCounterEl) playerCounterEl.textContent = '';
                    }
                }
                
                // 6. Ocultar botones y overlays
                document.getElementById('btn-start-rematch').style.display = 'none';
                document.getElementById('start-game-btn').style.display = 'none';
                hideOverlay('victory-overlay');
                hideOverlay('ready-overlay');
                
                // 7. Limpiar event listeners de cartas
                const deckEl = document.getElementById('deck');
                const discardEl2 = document.getElementById('discard');
                if (deckEl) deckEl.onclick = null;
                if (discardEl2) discardEl2.onclick = null;
                
                console.log('[Práctica] Estado limpiado. Solicitando nueva partida...');
                // ▲▲▲ FIN DE LIMPIEZA COMPLETA ▲▲▲
                
                // Asegurarnos que currentGameSettings exista antes de usarlo
                if (currentGameSettings && currentGameSettings.roomId) {
                    socket.emit('requestPracticeRematch', { roomId: currentGameSettings.roomId });
                } else {
                    console.error("No se pudo reiniciar la partida: roomId no encontrado.");
                    goBackToLobby(); // Fallback seguro
                }
            };
        }

        if (btnExit) {
            btnExit.onclick = () => {
                hideOverlay('practice-restart-modal');
                goBackToLobby();
            };
        }

        // ▼▼▼ AÑADIR EVENT LISTENERS PARA EL MODAL DE FUNCIONES ▼▼▼
        const btnShowFunctions = document.getElementById('btn-show-functions');
        const btnCloseFunctions = document.getElementById('btn-close-functions-modal');

        if (btnShowFunctions) {
            btnShowFunctions.onclick = showFunctionsModal;
        }
        if (btnCloseFunctions) {
            btnCloseFunctions.onclick = () => {
                hideFunctionsModal();
                // Si estamos en una partida de práctica, mostramos el siguiente modal.
                if (currentGameSettings && currentGameSettings.isPractice) {
                    showBotInfoModalOnce();
                }
            };
        }
        // Añade el handler para el botón del nuevo modal
        const btnCloseBotInfo = document.getElementById('btn-close-bot-info');
        if (btnCloseBotInfo) {
            btnCloseBotInfo.onclick = hideBotInfoModal;
        }

        // ▼▼▼ LÓGICA GLOBAL PARA LOS BOTONES DE CERRAR (X) ▼▼▼
        document.querySelectorAll('.close-modal-btn').forEach(btn => {
            btn.onclick = () => {
                // Busca el modal padre más cercano y lo oculta
                const modal = btn.closest('.overlay, [role="dialog"]');
                if (modal) {
                    modal.style.display = 'none';
                }
            };
        });
        // ▲▲▲ FIN DEL CÓDIGO AÑADIDO ▲▲▲

        // ▼▼▼ AÑADE ESTE BLOQUE DE CÓDIGO AQUÍ DENTRO ▼▼▼
        const btnAcceptVictory = document.getElementById('btn-accept-practice-victory');
        if (btnAcceptVictory) {
            btnAcceptVictory.onclick = () => {
                // 1. Oculta el modal de victoria
                hideOverlay('practice-victory-modal');
                // 2. Muestra el modal de reinicio
                showOverlay('practice-restart-modal');
            };
        }
        // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲
    });
    // ▲▲▲ FIN DEL BLOQUE A PEGAR ▲▲▲

    // ▼▼▼ AÑADE ESTE LISTENER COMPLETO ▼▼▼
    socket.on('resetForNewGame', (data) => {
        // No hacer nada aquí para no borrar el chat.
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER COMPLETO ▼▼▼

// ▼▼▼ REEMPLAZO COMPLETO Y DEFINITIVO ▼▼▼
    socket.on('gameStarted', (initialState) => {
    
    // ▼▼▼ VERIFICAR SI EL JUGADOR FUE ELIMINADO ANTES DE MOSTRAR LA VISTA DEL JUEGO ▼▼▼
    // Si shouldRedirectToLobbyAfterElimination está activo, no mostrar la vista del juego
    if (shouldRedirectToLobbyAfterElimination) {
        console.log('[gameStarted] Jugador fue eliminado, ignorando inicio de juego');
        return; // No mostrar la vista del juego
    }
    // ▲▲▲ FIN DE VERIFICACIÓN ▲▲▲
    
    // CORRECCIÓN CLAVE: Si es una partida de práctica, inicializamos manualmente
    // las configuraciones que las mesas reales inicializan por otra vía.
    if (initialState.isPractice) {
        
        // 1. Creamos el objeto de configuración que estaba ausente y causaba el error.
        currentGameSettings = {
            isPractice: true,
            roomId: `practice-${socket.id}`,
            settings: {
                username: 'Práctica', // Nombre placeholder para la mesa
                bet: 0,
                penalty: 0
            }
        };

        // 2. Ahora que la configuración existe, podemos mostrar la vista y activar los botones sin errores.
        document.body.classList.add('game-active');
        document.getElementById('lobby-overlay').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        setupChat();
        setupInGameLeaveButton();
        
        // ▼▼▼ AÑADIR ESTA LÍNEA PARA MOSTRAR EL MODAL EN PRÁCTICA ▼▼▼
        showFunctionsModalOnce();
    }

    // El resto del código es el que ya tenías y es correcto para AMBOS tipos de partida.
    
    // ▼▼▼ VERIFICAR SI EL JUGADOR FUE ELIMINADO ANTES DE MOSTRAR LA VISTA DEL JUEGO ▼▼▼
    // Si shouldRedirectToLobbyAfterElimination está activo, no mostrar la vista del juego
    if (shouldRedirectToLobbyAfterElimination) {
        console.log('[gameStarted] Jugador fue eliminado, ignorando inicio de partida');
        return; // No mostrar la vista del juego
    }
    // ▲▲▲ FIN DE VERIFICACIÓN ▲▲▲
    
    document.querySelector('.player-actions').style.display = 'flex';
    resetClientGameState();
    console.log("Servidor ha iniciado la partida. Recibiendo estado:", initialState);
    
    document.getElementById('btn-start-rematch').style.display = 'none';
    hideOverlay('victory-overlay');
    hideOverlay('ready-overlay');
    // ▼▼▼ OCULTAR MODALES DE PRÁCTICA AL REINICIAR ▼▼▼
    hideOverlay('practice-victory-modal');
    hideOverlay('practice-restart-modal');
    practiceGameEndedByHumanFault = false; // Resetear bandera al reiniciar
    // ▲▲▲ FIN DE OCULTAR MODALES DE PRÁCTICA ▲▲▲
    document.getElementById('start-game-btn').style.display = 'none';
    
    gameStarted = true;
    allMelds = initialState.melds || [];
    turnMelds = [];
    selectedCards = new Set();
    isDrawing = false;
    
    updatePlayersView(initialState.seats, true);
    
    // El mensaje del primer turno se mostrará a través del evento firstTurnInfo
    // No mostrar aquí para evitar duplicados
    
    // ▼▼▼ CORRECCIÓN ▼▼▼
    // Asignamos la mano directamente al jugador local, que la lógica de la UI 
    // siempre posiciona en el índice 0 del array 'players'.
    if (players[0]) {
        players[0].hand = initialState.hand;
    }
    // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
    
    discardPile = initialState.discardPile;
    
    const startingPlayer = initialState.seats.find(sp => sp && sp.playerId === initialState.currentPlayerId);
    if (startingPlayer) {
        currentPlayer = orderedSeats.findIndex(s => s && s.playerId === startingPlayer.playerId);
    } else {
        currentPlayer = 0;
    }
    
    // ▼▼▼ CORRECCIÓN ▼▼▼
    // Reemplazamos la referencia a 'myPlayerData' por 'players[0]', que es la correcta.
    const myPlayerData = players[0]; // Definimos la variable para que el código sea más legible.
    // El primer jugador puede tener 15 o 16 cartas al inicio (16 si es el que empieza)
    if (myPlayerData && myPlayerData.hand && (myPlayerData.hand.length === 15 || myPlayerData.hand.length === 16)) {
        hasDrawn = true;
        mustDiscard = true;
        isFirstDiscard = true; // Marcar que el próximo descarte será el primero
        // NO mostrar toast aquí - el mensaje se mostrará a través de firstTurnInfo
    } else {
        hasDrawn = false;
        mustDiscard = false;
        isFirstDiscard = false;
    }
    // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
    
    // ▼▼▼ VERIFICAR SI ES EL PRIMER TURNO DEL JUGADOR ACTUAL (PARA REVANCHAS Y NUEVOS JUEGOS) ▼▼▼
    // Si el servidor envió isFirstTurn y el jugador actual es este socket, mostrar el mensaje
    if (initialState.isFirstTurn && initialState.currentPlayerId === socket.id) {
        console.log('[Cliente] Es el primer turno del jugador en revancha/nuevo juego, mostrando mensaje inmediatamente');
        setTimeout(() => {
            showToast('¡Es tu primer turno! Empiezas con 15 cartas. Debes descartar una carta para comenzar el juego.', 8000, true); // Centrado en pantalla
            if (typeof addChatMessage === 'function') {
                addChatMessage(null, '¡Es tu primer turno! Empiezas con 15 cartas. Debes descartar una carta para comenzar el juego.', 'system');
            }
        }, 500); // Pequeño delay para asegurar que el toast esté listo
    }
    // ▲▲▲ FIN DE LA VERIFICACIÓN ▲▲▲

    if (initialState.playerHandCounts) {
        updatePlayerHandCounts(initialState.playerHandCounts);
    }

    setupPileTouchInteractions();
    setupMeldDropZone();
    
    animateDealing(initialState).then(() => {
        renderHands();
        updateTurnIndicator();
        updateActionButtons();
    });
});

    // ▼▼▼ CRÍTICO: Handler para sincronización de estado durante reconexión (NO reinicia el juego) ▼▼▼
    socket.on('gameStateSync', (gameState) => {
        console.log('[gameStateSync] Sincronizando estado del juego durante reconexión:', gameState);
        
        // ▼▼▼ VERIFICAR SI EL JUGADOR FUE ELIMINADO ANTES DE SINCRONIZAR ▼▼▼
        if (shouldRedirectToLobbyAfterElimination) {
            console.log('[gameStateSync] Jugador fue eliminado, ignorando sincronización');
            return;
        }
        // ▲▲▲ FIN DE VERIFICACIÓN ▲▲▲
        
        // NO llamar a resetClientGameState() - solo sincronizar el estado actual
        // NO llamar a animateDealing() - las cartas ya están repartidas
        
        // Asegurar que gameStarted esté en true si el juego está en curso
        if (!gameStarted && gameState.seats && gameState.seats.some(s => s && s.active !== false)) {
            gameStarted = true;
        }
        
        // Actualizar estado del juego sin reiniciar
        if (gameState.hand) {
            if (players.length === 0 || !players[0]) {
                // Si no hay players, inicializar con la mano recibida
                players = [{
                    playerId: socket.id,
                    hand: gameState.hand,
                    playerName: currentUser.username || 'Jugador'
                }];
            } else {
                players[0].hand = gameState.hand;
            }
        }
        
        discardPile = gameState.discardPile || [];
        allMelds = gameState.melds || [];
        turnMelds = [];
        if (selectedCards) {
            selectedCards.clear();
        } else {
            selectedCards = new Set();
        }
        
        // Actualizar vista de jugadores (esto también actualiza orderedSeats)
        if (gameState.seats) {
            updatePlayersView(gameState.seats, gameStarted);
        }
        
        // Actualizar contadores de cartas
        if (gameState.playerHandCounts) {
            updatePlayerHandCounts(gameState.playerHandCounts);
        }
        
        // Actualizar jugador actual
        if (gameState.seats && gameState.currentPlayerId) {
            const currentPlayerSeat = gameState.seats.find(sp => sp && sp.playerId === gameState.currentPlayerId);
            if (currentPlayerSeat && orderedSeats && orderedSeats.length > 0) {
                const playerIndex = orderedSeats.findIndex(s => s && s.playerId === currentPlayerSeat.playerId);
                if (playerIndex !== -1) {
                    currentPlayer = playerIndex;
                }
            }
        }
        
        // Renderizar manos y actualizar UI sin animación de reparto
        renderHands();
        updateTurnIndicator();
        updateActionButtons();
        
        // Actualizar pila de descarte visualmente
        const discardEl = document.getElementById('discard');
        if (discardEl) {
            if (discardPile.length > 0) {
                const topCard = discardPile[discardPile.length - 1];
                const suitSymbol = topCard.suit === 'hearts' ? '♥' : topCard.suit === 'diamonds' ? '♦' : topCard.suit === 'clubs' ? '♣' : '♠';
                discardEl.innerHTML = `<div class="card ${topCard.suit}">${topCard.rank}${suitSymbol}</div>`;
            } else {
                discardEl.innerHTML = 'Descarte<br>Vacío';
            }
        }
        
        console.log('[gameStateSync] ✅ Estado sincronizado correctamente sin reiniciar el juego');
    });
    // ▲▲▲ FIN HANDLER DE SINCRONIZACIÓN DE ESTADO ▲▲▲

    socket.on('playerJoined', (roomData) => {
        console.log('Un jugador se ha unido a la sala:', roomData);
        currentGameSettings = { ...currentGameSettings, ...roomData };
        // ▼▼▼ CRÍTICO: Asegurar que hostId esté establecido correctamente ▼▼▼
        if (roomData.hostId) {
            currentGameSettings.hostId = roomData.hostId;
            console.log(`[playerJoined] hostId actualizado: ${roomData.hostId}`);
        }
        // ▲▲▲ FIN ESTABLECER HOSTID ▲▲▲
        updatePlayersView(roomData.seats, gameStarted);
        renderGameControls();
    });

    socket.on('playerLeft', (roomData) => {
        console.log('Un jugador ha abandonado la sala:', roomData);
        currentGameSettings = { ...currentGameSettings, ...roomData };
        updatePlayersView(roomData.seats, gameStarted); // Pasamos el estado actual del juego
        renderGameControls();
    });
    
    function resetClientGameState() {
        console.log('CLIENTE: Reseteando estado del juego para nueva partida.');

        gameStarted = false;
        players = [];
        orderedSeats = []; // <<-- ESTA ES LA LÍNEA QUE FALTABA Y SOLUCIONA TODO
        deck = [];
        discardPile = [];
        currentPlayer = 0;
        allMelds = [];
        turnMelds = [];
        unreadMessages = 0;
        isWaitingForNextTurn = false;

        hasDrawn = false;
        drewFromDiscard = false;
        discardCardUsed = null;
        mustDiscard = false;
        drewFromDeckToWin = false;
        isDrawing = false;
        if (selectedCards) selectedCards.clear();

        // El resto del código de limpieza que ya tenías
        document.getElementById('human-hand').innerHTML = '';
        document.getElementById('melds-display').innerHTML = '';
        document.getElementById('discard').innerHTML = 'Descarte<br>Vacío';
        document.getElementById('start-game-btn').style.display = 'none';

        hideOverlay('victory-overlay');

        const deckEl = document.getElementById('deck');
        const discardEl = document.getElementById('discard');
        if (deckEl) deckEl.onclick = null;
        if (discardEl) discardEl.onclick = null;

        for (let i = 0; i < 4; i++) {
            const playerInfoEl = document.getElementById(`info-player${i}`);
            if (playerInfoEl) {
                playerInfoEl.classList.remove('current-turn-glow');
                const playerNameEl = playerInfoEl.querySelector('.player-name');
                const playerAvatarEl = playerInfoEl.querySelector('.player-avatar');
                const playerCounterEl = playerInfoEl.querySelector('.card-counter');
                playerNameEl.textContent = "Asiento Vacío";
                playerAvatarEl.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                playerCounterEl.textContent = '';
            }
        }
    }
    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲
    
    window.initializeGame = function(settings) {
        resetClientGameState(); // Esta línea ya la tenías, déjala como está
        currentGameSettings = settings;
        
        // ▼▼▼ AÑADE ESTE BLOQUE JUSTO AL PRINCIPIO DE la función initializeGame ▼▼▼
        // Reseteo robusto y explícito del estado de la UI del chat.
        const chatWindowForReset = document.getElementById('chat-window');
        if (chatWindowForReset) {
            chatWindowForReset.classList.remove('visible');
        }
        const badgeForReset = document.getElementById('chat-notification-badge');
        if (badgeForReset) {
            badgeForReset.style.display = 'none';
            badgeForReset.textContent = '0';
        }
        unreadMessages = 0;
        // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲
        // MIGRACIÓN SEGURA: Mantener datos originales del usuario
        currentUser.name = currentUser.username || localStorage.getItem('username');
        currentUser.id = socket.id;
        // ▼▼▼ CRÍTICO: Asegurar que userId esté establecido para verificación de host ▼▼▼
        if (!currentUser.userId) {
            currentUser.userId = sessionStorage.getItem('userId') || localStorage.getItem('userId');
        }
        // ▲▲▲ FIN ESTABLECER USERID ▲▲▲

        // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
        const gameContainer = document.getElementById('game-container');

        const readyOverlay = document.getElementById('ready-overlay');
        const welcomeMsg = document.getElementById('welcome-message');
        const betInfo = document.getElementById('bet-info');
        const penaltyInfo = document.getElementById('penalty-info');
        const mainButton = document.getElementById('btn-ready-main');
        const spectatorButton = document.getElementById('btn-spectator-sit');

        // Ocultar elementos de revancha por si acaso
        document.getElementById('rematch-status').innerHTML = '';
        document.getElementById('btn-start-rematch').style.display = 'none';

        // Lógica condicional: ¿Es un espectador o un jugador?
        if (settings.isSpectator) {
            // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
            gameContainer.classList.add('spectator-view');

            gameStarted = true;
            updatePlayersView(settings.seats, true);
            allMelds = settings.melds || [];
            discardPile = settings.discardPile || [];
            renderMelds();
            renderDiscard();
            document.getElementById('human-hand').innerHTML = '';
            document.querySelector('.player-actions').style.display = 'none';

            if (spectatorMode === 'wantsToPlay') {
                // Muestra el modal SOLO si el espectador eligió "Unirse y Esperar".
                welcomeMsg.innerHTML = `Partida en curso.<br>Estás viendo como espectador.`;
                betInfo.textContent = `Apuesta: ${settings.settings.bet}`;
                penaltyInfo.textContent = `Multa: ${settings.settings.penalty}`;
                mainButton.style.display = 'none';
                spectatorButton.style.display = 'block';
                spectatorButton.disabled = false;
                spectatorButton.textContent = '✔️ Sentarse en la Próxima Partida';
                spectatorButton.onclick = () => {
                    socket.emit('requestToSit', settings.roomId);
                    hideOverlay('ready-overlay');
                };
                showOverlay('ready-overlay');
            } else {
                // Si el modo es 'spectateOnly', no mostramos ningún modal.
                hideOverlay('ready-overlay');
            }
            
        } else {
            // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
            gameContainer.classList.remove('spectator-view');

            // Lógica original para un jugador que se une a una mesa en espera
            console.log('Inicializando la vista de juego como JUGADOR.');
            gameStarted = false;
            
            // ▼▼▼ CRÍTICO: Solo mostrar el modal de bienvenida UNA VEZ por sala ▼▼▼
            const roomId = settings.roomId;
            if (welcomeModalShownForRoom !== roomId) {
                welcomeMsg.textContent = `Bienvenido a la mesa de ${settings.settings.username}`;
                betInfo.textContent = `Apuesta: ${settings.settings.bet}`;
                penaltyInfo.textContent = `Multa: ${settings.settings.penalty}`;
                mainButton.style.display = 'block';
                spectatorButton.style.display = 'none';
                
                if (settings.isPractice) {
                    mainButton.textContent = 'Empezar Práctica';
                    mainButton.onclick = () => {
                        hideOverlay('ready-overlay');
                        // Esta parte necesita ser implementada o revisada
                        console.error("Lógica de práctica debe ser iniciada desde el servidor.");
                    };
                } else {
                    mainButton.textContent = 'Sentarse';
                    mainButton.onclick = handleSitDown;
                }

                updatePlayersView(settings.seats, false);
                document.querySelector('.player-actions').style.display = 'flex';
                showOverlay('ready-overlay');
                
                // Marcar que el modal ya se mostró para esta sala
                welcomeModalShownForRoom = roomId;
                console.log(`[initializeGame] Modal de bienvenida mostrado para sala ${roomId}`);
            } else {
                // El modal ya se mostró antes, solo ocultarlo y continuar
                hideOverlay('ready-overlay');
                updatePlayersView(settings.seats, false);
                document.querySelector('.player-actions').style.display = 'flex';
                console.log(`[initializeGame] Modal de bienvenida ya se mostró para sala ${roomId}, omitiendo.`);
            }
            // ▲▲▲ FIN: SOLO MOSTRAR MODAL UNA VEZ ▲▲▲
        }

        // Configuración común

        setupChat();
        document.getElementById('melds-display').innerHTML = '';
        renderDiscard();
        setupInGameLeaveButton();
        
        // ▼▼▼ CRÍTICO: Llamar a renderGameControls después de inicializar para mostrar el botón de iniciar si es el host ▼▼▼
        renderGameControls();
        // ▲▲▲ FIN LLAMADA A RENDERGAMECONTROLS ▲▲▲
    }

    function setupInGameLeaveButton() {
        const leaveButton = document.getElementById('btn-back-to-lobby-ingame');
        const modal = document.getElementById('confirm-leave-modal');
        const messageEl = document.getElementById('confirm-leave-message');
        const confirmBtn = document.getElementById('btn-confirm-leave-yes');
        const cancelBtn = document.getElementById('btn-confirm-leave-no');

        if (!leaveButton || !modal) return;

        leaveButton.onclick = () => {
            const isActivePlayer = orderedSeats.some(s => s && s.playerId === socket.id && s.active !== false && s.status !== 'waiting');
            
            // Se añade la comprobación "&& gameStarted"
            if (isActivePlayer && gameStarted) {
                messageEl.innerHTML = '¿Estás seguro de que quieres volver al lobby? <br><strong style="color: #ff4444;">Se contará como una derrota y pagarás la apuesta y la multa.</strong>';
            } else {
                messageEl.textContent = '¿Estás seguro de que quieres volver al lobby?';
            }
            modal.style.display = 'flex';
        };

        confirmBtn.onclick = () => {
            // ▼ REEMPLAZA ESTA LÍNEA... ▼
            // socket.emit('leaveGame', { roomId: currentGameSettings.roomId });
            // ▼ ...CON ESTA LÍNEA ▼
            goBackToLobby();
            modal.style.display = 'none';
        };

        cancelBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }

    
    function handleSitDown() {
        hideOverlay('ready-overlay');
        
        // ▼▼▼ AÑADIR ESTA LÍNEA PARA MOSTRAR EL MODAL EN MESAS REALES ▼▼▼
        showFunctionsModalOnce();
        
        renderGameControls();
    }
    
    function renderGameControls() {
        const startGameBtn = document.getElementById('start-game-btn');
        
        // ▼▼▼ CRÍTICO: Verificar si es el host comparando socket.id con hostId o userId con settings.userId ▼▼▼
        // El hostId puede ser socket.id o podemos verificar por userId
        const hostId = currentGameSettings?.hostId;
        const hostUserId = currentGameSettings?.settings?.userId;
        const myUserId = currentUser.userId || (sessionStorage.getItem('userId') || localStorage.getItem('userId'));
        
        // Verificar si es el host por socket.id o por userId
        const isHostBySocketId = hostId === socket.id;
        const isHostByUserId = hostUserId && myUserId && hostUserId === myUserId;
        const isHost = isHostBySocketId || isHostByUserId;
        
        console.log(`[renderGameControls] Verificando si es host - hostId: ${hostId}, socket.id: ${socket.id}, hostUserId: ${hostUserId}, myUserId: ${myUserId}, isHost: ${isHost}, gameStarted: ${gameStarted}`);
        // ▲▲▲ FIN VERIFICACIÓN DE HOST ▲▲▲

        if (isHost && !gameStarted && currentGameSettings && currentGameSettings.seats) {
            startGameBtn.style.display = 'block';
            const playerCount = currentGameSettings.seats.filter(s => s !== null && s !== undefined).length;
            
            startGameBtn.disabled = playerCount < 2;

            if (playerCount < 2) {
                startGameBtn.title = "Se necesitan al menos 2 jugadores para empezar.";
            } else {
                startGameBtn.title = "Iniciar la partida.";
            }

            startGameBtn.onclick = () => {
                console.log("Host iniciando la partida...");
                socket.emit('startGame', currentGameSettings.roomId);
            };
            
            console.log(`[renderGameControls] ✅ Botón de iniciar mostrado. Jugadores: ${playerCount}, disabled: ${startGameBtn.disabled}`);
        } else {
            startGameBtn.style.display = 'none';
            console.log(`[renderGameControls] ❌ Botón de iniciar oculto - isHost: ${isHost}, gameStarted: ${gameStarted}, currentGameSettings: ${!!currentGameSettings}`);
        }
    }

    let orderedSeats = [];

// ▼▼▼ REEMPLAZA LA FUNCIÓN updatePlayersView ENTERA CON ESTE CÓDIGO ORIGINAL ▼▼▼
// ▼▼▼ REEMPLAZA LA FUNCIÓN updatePlayersView ENTERA CON ESTE CÓDIGO ▼▼▼
function updatePlayersView(seats, inGame = false) {
    // --- INICIO DE LA LÓGICA DE CORRECCIÓN DEFINITIVA ---

    // 1. Encontrar mi propio índice en los asientos del servidor.
    // Si soy espectador (myIndex === -1), uso la vista del anfitrión (asiento 0).
    let myIndex = seats.findIndex(s => s && s.playerId === socket.id);
    if (myIndex === -1) {
        myIndex = 0;
    }

    // 2. Rotar los asientos para que mi vista siempre me ponga en la parte inferior.
    orderedSeats = seats.slice(myIndex).concat(seats.slice(0, myIndex));
    
    // 3. Crear un array de jugadores FRESCO. NO reutilizamos datos viejos.
    const newPlayers = [];
    const myCurrentHand = (players && players[0]) ? players[0].hand : []; // Salvamos la mano actual del jugador humano.

    for (let i = 0; i < 4; i++) {
        const seat = orderedSeats[i];
        const playerInfoEl = document.getElementById(`info-player${i}`);
        if (!playerInfoEl) continue;

        const playerNameEl = playerInfoEl.querySelector('.player-name');
        const playerAvatarEl = playerInfoEl.querySelector('.player-avatar');
        const playerCounterEl = playerInfoEl.querySelector('.card-counter');
        const playerDetailsEl = playerInfoEl.querySelector('.player-details');

        // Limpieza de botones de "Sentarse" residuales para evitar duplicados.
        const oldSitBtn = playerDetailsEl.querySelector('.sit-down-btn');
        if (oldSitBtn) oldSitBtn.remove();
        
        if (seat) {
            // --- LÓGICA PARA UN ASIENTO OCUPADO ---
            playerInfoEl.classList.remove('empty-seat');
            playerInfoEl.style.visibility = 'visible';
            playerNameEl.textContent = seat.playerName;
            playerAvatarEl.src = seat.avatar || 'https://i.pravatar.cc/150?img=1';
            playerInfoEl.classList.remove('player-waiting');

            if (seat.status === 'waiting') {
                playerCounterEl.textContent = '';
                playerInfoEl.classList.add('player-waiting');
            } else {
                playerCounterEl.textContent = gameStarted ? '' : 'Listo';
            }

            // Se crea el objeto de jugador desde cero.
            const playerObject = {
                name: seat.playerName,
                hand: [], // La mano se asignará después si es el jugador local.
                isBot: false,
                active: seat.active !== false
            };

            // Si este asiento corresponde al jugador local, le asignamos su mano.
            if (i === 0) {
                playerObject.hand = myCurrentHand;
            }
            newPlayers[i] = playerObject;
            
        } else {
            // --- LÓGICA PARA UN ASIENTO VACÍO ---
            playerInfoEl.style.visibility = 'visible';
            playerInfoEl.classList.add('empty-seat');
            playerInfoEl.classList.remove('player-waiting');
            playerNameEl.textContent = "Asiento Vacío";
            playerAvatarEl.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
            playerCounterEl.innerHTML = '';
            newPlayers[i] = null;

            // Lógica para que un espectador vea el botón de "Sentarse"
        }
    }

    // 4. Reemplazamos la lista de jugadores vieja con la nueva, totalmente sincronizada.
    players = newPlayers;
}
// ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲
    
    async function animateDealing(initialState) {
        playSound('deal'); // <--- AÑADE ESTA LÍNEA AQUÍ
        const deckEl = document.getElementById('deck');
        const seatedPlayers = initialState.seats.filter(s => s !== null);

        for (let i = 0; i < 14; i++) {
            for (const seat of seatedPlayers) {
                const playerViewIndex = orderedSeats.findIndex(os => os && os.playerId === seat.playerId);
                if (playerViewIndex !== -1) {
                    const playerInfoEl = document.getElementById(`info-player${playerViewIndex}`);
                    await animateCardMovement({
                        startElement: deckEl,
                        endElement: playerInfoEl,
                        isBack: true,
                        duration: 80
                    });
                }
            }
        }
        
        const startingPlayerId = initialState.currentPlayerId;
        const startingPlayerViewIndex = orderedSeats.findIndex(os => os && os.playerId === startingPlayerId);
        if (startingPlayerViewIndex !== -1) {
             const playerInfoEl = document.getElementById(`info-player${startingPlayerViewIndex}`);
             await animateCardMovement({
                startElement: deckEl,
                endElement: playerInfoEl,
                isBack: true,
                duration: 80
             });
        }
        
        // Mensaje eliminado: "¡Repartiendo cartas!"
        await new Promise(r => setTimeout(r, 500));
    }


    function setupPileTouchInteractions() {
        const deckEl = document.getElementById('deck');
        const discardEl = document.getElementById('discard');

        // Limpiar manejadores para evitar duplicados
        deckEl.onclick = null;
        deckEl.ontouchend = null;
        discardEl.onclick = null;
        discardEl.ontouchend = null;

        // Manejador unificado simple
        const handleInteraction = (action) => (event) => {
            event.preventDefault(); // Prevenir comportamientos por defecto (zoom, clic fantasma)
            event.stopPropagation(); // Detener el evento aquí para que no interfiera con otros
            action();
        };

        // Lógica para el Mazo
        const deckAction = () => {
            if (currentPlayer !== 0 || !gameStarted || hasDrawn || mustDiscard) return;
            drawFromDeck();
        };

        // Lógica para el Descarte
        const discardAction = () => {
            if (currentPlayer !== 0 || !gameStarted) return;
            if (hasDrawn || mustDiscard) {
                attemptDiscard();
            } else {
                drawFromDiscard();
            }
        };

        // Asignar los listeners
        deckEl.addEventListener('click', handleInteraction(deckAction));
        deckEl.addEventListener('touchend', handleInteraction(deckAction));

        discardEl.addEventListener('click', handleInteraction(discardAction));
        discardEl.addEventListener('touchend', handleInteraction(discardAction));
    }

    // ▼▼▼ REEMPLAZA TU FUNCIÓN window.goBackToLobby ENTERA CON ESTA VERSIÓN SIMPLIFICADA ▼▼▼
    window.goBackToLobby = function() {
        // ▼▼▼ CRÍTICO: Verificar si el juego está activo antes de emitir leaveGame ▼▼▼
        // Si el juego está activo, NO emitir leaveGame - el servidor lo bloqueará y el timeout se encargará
        const isGameActive = currentGameSettings && currentGameSettings.roomId && 
                            document.body.classList.contains('game-active');
        
        if (currentGameSettings && currentGameSettings.roomId && !isGameActive) {
            console.log('🔌 [CLIENTE DEBUG] goBackToLobby llamado - emitiendo leaveGame (juego no activo)');
            console.log('🔌 [CLIENTE DEBUG] Stack trace:', new Error().stack);
            console.log('Notificando al servidor la salida de la sala para limpieza...');
            socket.emit('leaveGame', { roomId: currentGameSettings.roomId });
        } else if (isGameActive) {
            console.log('🔌 [CLIENTE DEBUG] goBackToLobby llamado pero juego está activo - NO emitiendo leaveGame (el servidor lo bloqueará)');
        }
        // ▲▲▲ FIN VERIFICACIÓN DE JUEGO ACTIVO ▲▲▲

        // --- EL BLOQUE DE "NUEVA IDENTIDAD" HA SIDO ELIMINADO ---
        // Ya no se genera un nuevo userId cada vez. La identidad del jugador
        // se mantiene estable desde que inicia sesión hasta que la cierra.

        // Limpiamos las variables de la partida anterior
        resetClientGameState();
        currentGameSettings = null; // Limpiar configuración de la partida anterior

        // ▼▼▼ AÑADE ESTE BLOQUE ▼▼▼
        // Reseteamos visualmente el bote al salir de la partida
        const potValueEl = document.querySelector('#game-pot-container .pot-value');
        if (potValueEl) {
            potValueEl.textContent = '0';
        }
        // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲
        
        // Mostramos la vista del lobby
        showLobbyView();
    }
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

    function getCardImageUrl(card) {
        if (!card || !card.value || !card.suit) {
            return 'https://deckofcardsapi.com/static/img/back.png'; 
        }
        const valueMap = { 'A': 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '0', 'J': 'J', 'Q': 'Q', 'K': 'K' };
        const suitMap = { 'hearts': 'H', 'diamonds': 'D', 'clubs': 'C', 'spades': 'S' };
        const value = valueMap[card.value];
        const suit = suitMap[card.suit];
        if (!value || !suit) {
            return 'https://deckofcardsapi.com/static/img/back.png';
        }
        return `https://deckofcardsapi.com/static/img/${value}${suit}.png`;
    }

    // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO ANTES DE la función setupChat ▼▼▼

    // 1. Funciones que manejarán los eventos del chat. Las separamos para poder
    //    añadir y quitar los listeners de forma controlada.

    function handleChatToggle() {
        const chatWindow = document.getElementById('chat-window');
        if (!chatWindow) return;

        chatWindow.classList.toggle('visible');

        if (chatWindow.classList.contains('visible')) {
            unreadMessages = 0;
            const badge = document.getElementById('chat-notification-badge');
            if (badge) badge.style.display = 'none';

            const input = document.getElementById('chat-input');
            if (input) input.focus();

            const messagesContainer = document.getElementById('chat-messages');
            if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    function handleChatSend() {
        const input = document.getElementById('chat-input');
        if (!input) return;

        const message = input.value.trim();
        if (message && currentGameSettings && currentGameSettings.roomId) {
            socket.emit('sendGameChat', {
                roomId: currentGameSettings.roomId,
                message: message,
                sender: currentUser.name || 'Jugador'
            });
            input.value = '';
        }
    }

    function handleChatKeypress(e) {
        if (e.key === 'Enter') {
            handleChatSend();
        }
    }
    // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

    // ▼▼▼ REEMPLAZA TU FUNCIÓN setupChat ENTERA CON ESTA VERSIÓN ▼▼▼
    function setupChat() {
        const toggleBtn = document.getElementById('chat-toggle-btn');
        const sendBtn = document.getElementById('chat-send-btn');
        const input = document.getElementById('chat-input');

        if (!toggleBtn || !sendBtn || !input) {
            console.error("No se encontraron los elementos de la UI del chat.");
            return;
        }

        // --- LA MAGIA ESTÁ AQUÍ ---
        // Eliminamos los listeners antiguos antes de añadir los nuevos.
        // Esto previene la acumulación de eventos y soluciona el bug de raíz.
        toggleBtn.removeEventListener('click', handleChatToggle);
        toggleBtn.addEventListener('click', handleChatToggle);

        sendBtn.removeEventListener('click', handleChatSend);
        sendBtn.addEventListener('click', handleChatSend);

        input.removeEventListener('keypress', handleChatKeypress);
        input.addEventListener('keypress', handleChatKeypress);

        // El resto de la lógica que tenías (como el botón de reglas) puede permanecer si lo deseas.
        const rulesBtn = document.getElementById('game-rules-btn');
        const rulesModal = document.getElementById('rules-modal');
        if (rulesBtn && rulesModal) {
            // Hacemos lo mismo por seguridad
            rulesBtn.removeEventListener('click', () => rulesModal.style.display = 'flex');
            rulesBtn.addEventListener('click', () => {
                rulesModal.style.display = 'flex';
            });
        }

        // Mantener la lógica del chat UI content
        const chatUiContent = document.getElementById('chat-ui-content');
        if (chatUiContent) {
            chatUiContent.innerHTML = '';
            if (currentUser.role === 'spectator') {
                const sitDownArea = document.createElement('div');
                sitDownArea.id = 'spectator-controls';
                sitDownArea.innerHTML = `<button id="sit-down-btn">Sentarse en la próxima partida</button>`;
                chatUiContent.appendChild(sitDownArea);
                document.getElementById('sit-down-btn').addEventListener('click', () => {
                    const credits = 500;
                    if (credits >= currentGameSettings.bet + currentGameSettings.penalty) {
                        showToast("Te has sentado. Esperando a la siguiente partida...", 3000);
                    } else { showToast("No tienes créditos suficientes para sentarte.", 3000); }
                });
            } else if (currentUser.role === 'host') { 
                renderSpectatorListForHost(); 
            }
            addChatMessage(null, `Bienvenido a la mesa de ${currentGameSettings.settings.username}.`, 'system');
        }
    }
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    function addChatMessage(sender, message, role) {
        const messagesInner = document.getElementById('chat-messages-inner');
        const li = document.createElement('li');
        li.classList.add(role);
        li.innerHTML = (role === 'system') ? message : `<span class="sender">${sender}</span>${message}`;
        messagesInner.appendChild(li);
        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    function renderSpectatorListForHost() { }
    // Versión definitiva de discardCardByIndex
    async function discardCardByIndex(index) {
        if (isWaitingForNextTurn) return;
        playSound('discard'); // <--- AÑADE ESTA LÍNEA
        const p = players[0];
        if (!p) return;

        const cardToDiscard = p.hand[index];

        // ▼▼▼ OCULTAR MENSAJE DEL PRIMER TURNO AL DESCARTAR LA PRIMERA CARTA ▼▼▼
        // Verificar si es el primer descarte del juego
        if (isFirstDiscard) {
            // Ocultar el toast del primer turno si está visible (verificar por texto también)
            const toast = document.getElementById('toast');
            if (toast) {
                const toastText = toast.textContent || '';
                // Verificar si el toast contiene el mensaje del primer turno
                if (toastText.includes('primer turno') || toastText.includes('15 cartas') || toast.classList.contains('first-turn')) {
                    // Ocultar completamente el toast del primer turno y restaurar posición por defecto
                    toast.classList.remove('show');
                    toast.classList.remove('first-turn');
                    toast.style.display = 'none';
                    toast.style.opacity = '0';
                    toast.style.visibility = 'hidden';
                    toast.style.top = 'auto';
                    toast.style.bottom = '26px';
                    toast.style.transform = 'translateX(-50%)';
                    toast.textContent = ''; // Limpiar el texto también
                    console.log('[Cliente] ✅ Mensaje del primer turno ocultado al descartar la primera carta');
                }
            }
            // Limpiar el timeout si existe
            if (firstTurnToastTimeout) {
                clearTimeout(firstTurnToastTimeout);
                firstTurnToastTimeout = null;
            }
            // Marcar que ya no es el primer descarte
            isFirstDiscard = false;
        }
        // ▲▲▲ FIN DE OCULTAR MENSAJE DEL PRIMER TURNO ▲▲▲

        // 1. Emitir la acción al servidor.
        socket.emit('accionDescartar', { 
            roomId: currentGameSettings.roomId, 
            card: cardToDiscard 
        });

        // 2. Bloquear la UI y animar.
        isWaitingForNextTurn = true;
        updateActionButtons();

        const cardEl = document.querySelector(`#human-hand .card[data-index='${index}']`);
        const discardEl = document.getElementById('discard');
        if (cardEl && discardEl) {
            // La animación ahora es solo un efecto visual, no esperamos a que termine.
            animateCardMovement({ cardsData: [cardToDiscard], startElement: cardEl, endElement: discardEl });
        }

        // IMPORTANTE: No se modifica la mano ni se renderiza nada aquí.
        // Solo esperamos la respuesta del servidor.
    }
    
    function updatePlayerHandCounts(playerHandCounts) {
        // Actualiza los contadores de cartas de todos los jugadores en tiempo real
        for (let i = 0; i < 4; i++) {
            const playerInSeat = orderedSeats[i];
            if (playerInSeat && playerHandCounts[playerInSeat.playerId] !== undefined) {
                const counterEl = document.getElementById(`info-player${i}`)?.querySelector('.card-counter');
                if (counterEl && !counterEl.textContent.includes('❌ Eliminado')) {
                    const count = playerHandCounts[playerInSeat.playerId];
                    counterEl.textContent = `🂠 ${count}`;
                }
            }
        }
    }
    
    // ▼▼▼ LÓGICA UNIFICADA PARA SOLTAR CARTA (DROP) ▼▼▼
    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetElement = e.currentTarget; // Puede ser una carta o el contenedor de la mano
        targetElement.classList.remove('drag-over', 'drop-zone');

        try {
            const droppedIndices = JSON.parse(e.dataTransfer.getData('application/json'));
            const player = players[0];
            if (!player) return;

            let targetIndex;

            // CASO 1: Se suelta sobre OTRA CARTA
            if (targetElement.classList.contains('card')) {
                const rect = targetElement.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                const originalIndex = parseInt(targetElement.dataset.index);

                targetIndex = (e.clientX > midpoint) ? originalIndex + 1 : originalIndex;
            } 
            // CASO 2: Se suelta en un espacio vacío del CONTENEDOR de la mano
            else if (targetElement.id === 'human-hand') {
                const firstCard = targetElement.firstElementChild;
                const lastCard = targetElement.lastElementChild;
                targetIndex = player.hand.length; // Por defecto, va al final

                if (firstCard && lastCard) {
                    const firstCardRect = firstCard.getBoundingClientRect();
                    const lastCardRect = lastCard.getBoundingClientRect();

                    if (e.clientX < firstCardRect.left + (firstCardRect.width / 2)) {
                        targetIndex = 0; // Se suelta al principio
                    } else if (e.clientX > lastCardRect.left + (lastCardRect.width / 2)) {
                        targetIndex = player.hand.length; // Se suelta al final
                    }
                }
            }

            if (targetIndex !== undefined) {
                reorderHand(droppedIndices, targetIndex);
            }

        } catch (error) {
            console.error("Error al procesar el drop:", error);
            renderHands(); // Restaura la mano si algo falla
        }
    };
    // ▲▲▲ FIN LÓGICA UNIFICADA DROP ▲▲▲
    
    function renderHands() {
        const human = document.getElementById('human-hand');
        const parent = human.parentNode; // 1. Obtenemos el contenedor padre
        const newHuman = human.cloneNode(false); // 2. Creamos un nuevo 'human-hand' vacío en memoria

        const humanPlayer = players[0]; // Jugador local (puede ser espectador con mano vacía)

        // Si no hay un jugador local o la partida no ha comenzado, no hay mano que renderizar.
        // Esto es especialmente importante para la vista del espectador.
        if (!humanPlayer || !gameStarted || !humanPlayer.hand) {
            // Nos aseguramos de que otras partes de la UI se refresquen, pero no se renderizan cartas.
            renderDiscard();
            renderMelds();
            updateActionButtons();
            updateDebugInfo();
            return;
        }
      
      const fragment = document.createDocumentFragment();
      humanPlayer.hand.forEach((card, idx) => {
        // Verificar que la carta existe antes de acceder a sus propiedades
        if (!card || !card.id) {
            console.warn('Carta undefined o sin id en índice:', idx, card);
            return;
        }

        const d = document.createElement('div');
        d.className = 'card';
        if (selectedCards.has(card.id)) {
            d.classList.add('selected');
        }
        d.setAttribute('draggable', true);
        d.dataset.index = idx;
        d.dataset.cardId = card.id;
        d.innerHTML = `<img src="${getCardImageUrl(card)}" alt="${getSuitName(card.suit)}" style="width: 100%; height: 100%; border-radius: inherit; display: block;">`;

        let longPressTimer;

        // --- Lógica Original de Arrastre (Funciona en PC y Móvil) ---

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // La función 'startDrag' ahora lee la posición actual de la carta desde el propio elemento,
        // en lugar de usar una variable 'idx' que podría estar desactualizada.
        const startDrag = (e) => {
            // Mejor detección del elemento correcto para móviles
            let targetElement = e.currentTarget || e.target;
            
            // Si currentTarget es null, intentamos encontrar el elemento carta más cercano
            if (!targetElement || !targetElement.dataset) {
                // Buscar el elemento carta más cercano al punto de toque
                const touch = e.touches ? e.touches[0] : e;
                const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);
                targetElement = elementAtPoint?.closest('.card');
                
                if (!targetElement || !targetElement.dataset) {
                    console.warn('startDrag: No se pudo encontrar elemento carta válido');
                    return JSON.stringify([0]);
                }
            }
            
            const currentIdx = parseInt(targetElement.dataset.index);
            const selectedElements = document.querySelectorAll('#human-hand .card.selected');
            const isGroupDrag = selectedElements.length > 1 && targetElement.classList.contains('selected');

            let indicesToDrag = isGroupDrag ? Array.from(selectedElements).map(el => parseInt(el.dataset.index)) : [currentIdx];
            const dataToTransfer = JSON.stringify(indicesToDrag);

            // Para el arrastre en PC, se usa dataTransfer
            if (e.type === 'dragstart') {
                e.dataTransfer.setData('application/json', dataToTransfer);
                
                // Crea una imagen customizada para el arrastre de grupo en PC
                let dragImageContainer = document.createElement('div');
                dragImageContainer.style.position = 'absolute';
                dragImageContainer.style.left = '-1000px'; // Fuera de la pantalla
                if (isGroupDrag) {
                    dragImageContainer.style.display = 'flex';
                    selectedElements.forEach((selectedCard, index) => {
                        const clone = selectedCard.cloneNode(true);
                        clone.classList.remove('selected');
                        if (index > 0) clone.style.marginLeft = '-35px'; // Superponer
                        dragImageContainer.appendChild(clone);
                    });
                } else {
                    const clone = d.cloneNode(true);
                    clone.classList.remove('selected');
                    dragImageContainer.appendChild(clone);
                }
                document.body.appendChild(dragImageContainer);
                e.dataTransfer.setDragImage(dragImageContainer, 35, 52.5);
                setTimeout(() => document.body.removeChild(dragImageContainer), 0);
            }

            // Añade la clase 'dragging' para el efecto visual
            setTimeout(() => {
                indicesToDrag.forEach(i => {
                    const cardEl = document.querySelector(`#human-hand .card[data-index='${i}']`);
                    if (cardEl) cardEl.classList.add('dragging');
                });
            }, 0);

            return dataToTransfer; // Devuelve los datos para el manejador táctil
        };
        // --- FIN DE LA CORRECCIÓN CLAVE ---

        const endDrag = () => {
            clearTimeout(longPressTimer);
            document.querySelectorAll('#human-hand .card.dragging').forEach(c => c.classList.remove('dragging'));
        };

        // --- Lógica de Touch (Móvil) ---

        // Esta es la función clave del archivo original que faltaba
        // ▼▼▼ FUNCIÓN TOUCH CON LÓGICA DE PRECISIÓN Y EXTREMOS ▼▼▼
        const handleTouchDrag = (initialTouch, dragData) => {
            const cloneContainer = document.getElementById('drag-clone-container');
            cloneContainer.innerHTML = '';

            const indices = JSON.parse(dragData);
            const selectedElements = indices.map(i => document.querySelector(`#human-hand .card[data-index='${i}']`));
            
            const dragImage = document.createElement('div');
            dragImage.className = 'drag-clone-visual';
            dragImage.style.display = 'flex';

            selectedElements.forEach((el, i) => {
                if (!el) return;
                const clone = el.cloneNode(true);
                clone.classList.remove('selected', 'dragging');
                clone.style.transform = '';
                if (i > 0) clone.style.marginLeft = `-${clone.offsetWidth / 2}px`;
                dragImage.appendChild(clone);
            });

            cloneContainer.appendChild(dragImage);
            const offsetX = dragImage.offsetWidth / 2;
            const offsetY = dragImage.offsetHeight / 2;

            const updatePosition = (touch) => {
                cloneContainer.style.transform = `translate(${touch.clientX - offsetX}px, ${touch.clientY - offsetY}px)`;
            };
            updatePosition(initialTouch);

            let lastTarget = null;
            const dropTargets = [...document.querySelectorAll('#human-hand .card'), document.getElementById('human-hand'), document.getElementById('discard'), ...document.querySelectorAll('.meld-group'), document.querySelector('.center-area')];

            const onTouchMove = (e) => {
                e.preventDefault();
                const touch = e.touches[0];
                updatePosition(touch);

                cloneContainer.style.display = 'none';
                const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
                cloneContainer.style.display = 'block';
                
                let currentTarget = elementUnder ? dropTargets.find(dt => dt.contains(elementUnder)) : null;

                if (lastTarget && lastTarget !== currentTarget) {
                    lastTarget.classList.remove('drag-over', 'drop-zone'); // Se elimina 'drop-zone-hand'
                }
                if (currentTarget && currentTarget !== lastTarget) {
                    let className = 'drop-zone';
                    if (currentTarget.classList.contains('card')) {
                        className = 'drag-over';
                    }
                    // Ya no se necesita la clase 'drop-zone-hand'
                    currentTarget.classList.add(className);
                }
                lastTarget = currentTarget;
            };

            const onTouchEnd = (e) => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
                cloneContainer.innerHTML = '';
                
                if (lastTarget) {
                    lastTarget.classList.remove('drag-over', 'drop-zone');
                }
                
                document.querySelectorAll('#human-hand .card.dragging').forEach(c => c.classList.remove('dragging'));

                try {
                    // ▼▼▼ AÑADE ESTA LÍNEA DE SEGURIDAD AQUÍ ▼▼▼
                    if (!lastTarget) return;
                    // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

                    const droppedIndices = JSON.parse(dragData);

                    if (lastTarget.classList.contains('card')) {
                        const finalTouch = e.changedTouches[0];
                        const rect = lastTarget.getBoundingClientRect();
                        const midpoint = rect.left + rect.width / 2;
                        
                        let originalIndex = parseInt(lastTarget.dataset.index);
                        let targetIndex = originalIndex;

                        if (finalTouch.clientX > midpoint) {
                            targetIndex = originalIndex + 1;
                        }
                        
                        // Verificar que el reordenamiento es válido
                        if (targetIndex >= 0 && targetIndex <= players[0].hand.length) {
                            reorderHand(droppedIndices, targetIndex);
                        }

                    } 
                    // ▼▼▼ INICIO DEL BLOQUE MODIFICADO PARA MÓVIL ▼▼▼
                    else if (lastTarget.id === 'human-hand') {
                        const player = players[0];
                        if (!player) return;

                        const finalTouch = e.changedTouches[0];
                        const firstCard = lastTarget.firstElementChild;
                        const lastCard = lastTarget.lastElementChild;
                        let targetIndex = player.hand.length;

                        if (firstCard && lastCard) {
                            const firstCardRect = firstCard.getBoundingClientRect();
                            const lastCardRect = lastCard.getBoundingClientRect();

                            if (finalTouch.clientX < firstCardRect.left + (firstCardRect.width / 2)) {
                                targetIndex = 0;
                            } else if (finalTouch.clientX > lastCardRect.right - (lastCardRect.width / 2)) {
                                targetIndex = player.hand.length;
                            }
                        }
                        
                        // Verificar que el reordenamiento es válido
                        if (targetIndex >= 0 && targetIndex <= player.hand.length) {
                            reorderHand(droppedIndices, targetIndex);
                        }
                    } 
                    // ▲▲▲ FIN DEL BLOQUE MODIFICADO ▲▲▲
                    else if (lastTarget.id === 'discard') {
                        if (droppedIndices.length !== 1) { showToast('Solo puedes descartar una carta a la vez.', 2000); return; }
                        if (canDiscardByDrag()) discardCardByIndex(droppedIndices[0]);
                    } else if (lastTarget.classList.contains('center-area')) {
                        if (droppedIndices.length >= 3) {
                            // ¡Solución! Llamamos a la función que ya contiene la animación.
                            // Esto asegura un comportamiento idéntico al del botón.
                            window.attemptMeld();
                        } else {
                            showToast("Arrastra un grupo de 3 o más cartas para bajar.", 2000);
                        }
                    } else if (lastTarget.classList.contains('meld-group')) {
                        if (droppedIndices.length === 1) attemptAddCardToMeld(droppedIndices[0], parseInt(lastTarget.dataset.meldIndex));
                        else showToast("Arrastra solo una carta para añadir a una combinación existente.", 2500);
                    }
                } catch(err) {
                    console.error("Error en touch end:", err);
                    renderHands();
                }
            };
            
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        };


        // --- Asignación de Eventos (Como en el original) ---

        d.addEventListener('click', () => {
            if (selectedCards.has(card.id)) {
                selectedCards.delete(card.id);
                d.classList.remove('selected');
            } else {
                selectedCards.add(card.id);
                d.classList.add('selected');
            }
            updateActionButtons();
        });

        // ▼▼▼ RESTAURADO: Drag & drop nativo para PC ▼▼▼
        d.addEventListener('dragstart', startDrag);
        d.addEventListener('dragend', endDrag);
        // ▲▲▲ FIN RESTAURADO ▲▲▲

        d.addEventListener('touchstart', (e) => {
            // Asegurar que el evento se asocia correctamente con este elemento
            e.stopPropagation();
            
            // Iniciar un temporizador para el "toque largo"
            longPressTimer = setTimeout(() => {
                e.preventDefault(); // Previene scroll solo si es un toque largo
                
                // Crear un evento sintético que funcione mejor en móviles
                const syntheticEvent = {
                    currentTarget: d,
                    target: d,
                    touches: e.touches,
                    type: 'touchstart'
                };
                
                const dragData = startDrag(syntheticEvent);
                if (dragData) {
                    handleTouchDrag(e.touches[0], dragData);
                }
            }, 200);
        }, { passive: false });

        d.addEventListener('touchend', () => {
            clearTimeout(longPressTimer); // Si el dedo se levanta rápido, es un clic, no un arrastre
        });
        d.addEventListener('touchcancel', () => {
            clearTimeout(longPressTimer);
        });


        // Eventos de Drop (comunes para PC y Móvil simulado)
        d.addEventListener('dragover', (e) => {
            e.preventDefault();
            d.classList.add('drag-over');
        });
        d.addEventListener('dragleave', () => d.classList.remove('drag-over'));

        // ▼▼▼ LÓGICA UNIFICADA PARA SOLTAR CARTA ▼▼▼
        d.addEventListener('drop', handleDrop);

        fragment.appendChild(d);
    });
    
    newHuman.appendChild(fragment); // 3. Añadimos las cartas al NUEVO contenedor

    parent.replaceChild(newHuman, human); // 4. Reemplazamos el viejo por el nuevo de un solo golpe

    renderDiscard();
    renderMelds();
    updateActionButtons();
    updateDebugInfo();
}
// ▼▼▼ REEMPLAZA TU FUNCIÓN reorderHand ENTERA CON ESTA VERSIÓN ▼▼▼
function reorderHand(draggedIndices, targetDropIndex) {
    const player = players[0];
    const handContainer = document.getElementById('human-hand');
    if (!player || !handContainer) return;

    // 1. DATA: Actualizamos el array de datos interno para mantener la consistencia.
    // Esta lógica es la misma que ya tenías, pero es fundamental mantenerla.
    const sortedDraggedIndices = [...draggedIndices].sort((a, b) => b - a); // Orden descendente para no alterar índices al borrar
    const cardsToMoveData = sortedDraggedIndices.map(index => player.hand.splice(index, 1)[0]);
    cardsToMoveData.reverse(); // Restaurar el orden original del grupo arrastrado

    const insertionIndex = targetDropIndex - draggedIndices.filter(i => i < targetDropIndex).length;
    player.hand.splice(insertionIndex, 0, ...cardsToMoveData);

    // 2. VIEW (DOM): Movemos los elementos de las cartas directamente, sin redibujar.
    const cardsToMoveElements = draggedIndices.map(index => handContainer.querySelector(`.card[data-index='${index}']`)).filter(Boolean);
    const allCardElements = Array.from(handContainer.children);
    const referenceNode = allCardElements[targetDropIndex]; // El nodo antes del cual insertaremos

    if (referenceNode) {
        // Si hay un nodo de referencia, insertamos las cartas antes de él.
        cardsToMoveElements.forEach(el => handContainer.insertBefore(el, referenceNode));
    } else {
        // Si no hay (se suelta al final), simplemente las añadimos.
        cardsToMoveElements.forEach(el => handContainer.appendChild(el));
    }

    // 3. SYNC: Re-indexamos los atributos 'data-index' de todas las cartas en el DOM.
    // Esto es crucial para que los siguientes arrastres funcionen correctamente.
    const finalCardElements = Array.from(handContainer.children);
    finalCardElements.forEach((card, index) => {
        card.dataset.index = index;
        card.classList.remove('dragging', 'selected'); // Limpiamos clases residuales
    });

    // 4. Limpiamos la selección y actualizamos los botones.
    selectedCards.clear();
    updateActionButtons();

    // ¡NO SE LLAMA A renderHands()! Este es el cambio clave.
}
    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲

    // ▼▼▼ REEMPLAZA TU FUNCIÓN createCardElement ENTERA CON ESTA VERSIÓN COMPLETA ▼▼▼
    function createCardElement(card, idx) {
        if (!card || !card.id) {
            console.warn('Intentando crear un elemento para una carta inválida:', card);
            return document.createElement('div'); // Devuelve un div vacío para no romper el layout.
        }

        const d = document.createElement('div');
        d.className = 'card';
        d.setAttribute('draggable', true);
        d.dataset.index = idx;
        d.dataset.cardId = card.id;
        d.innerHTML = `<img src="${getCardImageUrl(card)}" alt="${getSuitName(card.suit)}" style="width: 100%; height: 100%; border-radius: inherit; display: block;">`;

        // --- INICIO DE LA LÓGICA DE EVENTOS COMPLETA (COPIADA DE renderHands) ---
        let longPressTimer;

        const startDrag = (e) => {
            // Verificación de seguridad para evitar el error "Cannot read properties of null"
            if (!e.currentTarget || !e.currentTarget.dataset) {
                console.warn('startDrag: currentTarget o dataset es null/undefined');
                return JSON.stringify([0]); // Fallback seguro
            }
            
            const currentIdx = parseInt(e.currentTarget.dataset.index);
            const selectedElements = document.querySelectorAll('#human-hand .card.selected');
            const isGroupDrag = selectedElements.length > 1 && e.currentTarget.classList.contains('selected');

            let indicesToDrag = isGroupDrag ? Array.from(selectedElements).map(el => parseInt(el.dataset.index)) : [currentIdx];
            const dataToTransfer = JSON.stringify(indicesToDrag);

            if (e.type === 'dragstart') {
                e.dataTransfer.setData('application/json', dataToTransfer);

                let dragImageContainer = document.createElement('div');
                dragImageContainer.style.position = 'absolute';
                dragImageContainer.style.left = '-1000px';
                if (isGroupDrag) {
                    dragImageContainer.style.display = 'flex';
                    selectedElements.forEach((selectedCard, index) => {
                        const clone = selectedCard.cloneNode(true);
                        clone.classList.remove('selected');
                        if (index > 0) clone.style.marginLeft = '-35px';
                        dragImageContainer.appendChild(clone);
                    });
                } else {
                    const clone = d.cloneNode(true);
                    clone.classList.remove('selected');
                    dragImageContainer.appendChild(clone);
                }
                document.body.appendChild(dragImageContainer);
                e.dataTransfer.setDragImage(dragImageContainer, 35, 52.5);
                setTimeout(() => document.body.removeChild(dragImageContainer), 0);
            }

            setTimeout(() => {
                indicesToDrag.forEach(i => {
                    const cardEl = document.querySelector(`#human-hand .card[data-index='${i}']`);
                    if (cardEl) cardEl.classList.add('dragging');
                });
            }, 0);

            return dataToTransfer;
        };

        const endDrag = () => {
            clearTimeout(longPressTimer);
            document.querySelectorAll('#human-hand .card.dragging').forEach(c => c.classList.remove('dragging'));
        };

        const handleTouchDrag = (initialTouch, dragData) => {
            const cloneContainer = document.getElementById('drag-clone-container');
            cloneContainer.innerHTML = '';
            const indices = JSON.parse(dragData);
            const selectedElements = indices.map(i => document.querySelector(`#human-hand .card[data-index='${i}']`));
            const dragImage = document.createElement('div');
            dragImage.className = 'drag-clone-visual';
            dragImage.style.display = 'flex';
            selectedElements.forEach((el, i) => {
                if (!el) return;
                const clone = el.cloneNode(true);
                clone.classList.remove('selected', 'dragging');
                clone.style.transform = '';
                if (i > 0) clone.style.marginLeft = `-${clone.offsetWidth / 2}px`;
                dragImage.appendChild(clone);
            });
            cloneContainer.appendChild(dragImage);
            const offsetX = dragImage.offsetWidth / 2;
            const offsetY = dragImage.offsetHeight / 2;
            const updatePosition = (touch) => {
                cloneContainer.style.transform = `translate(${touch.clientX - offsetX}px, ${touch.clientY - offsetY}px)`;
            };
            updatePosition(initialTouch);
            let lastTarget = null;
            const dropTargets = [...document.querySelectorAll('#human-hand .card'), document.getElementById('human-hand'), document.getElementById('discard'), ...document.querySelectorAll('.meld-group'), document.querySelector('.center-area')];
            const onTouchMove = (e) => {
                e.preventDefault();
                const touch = e.touches[0];
                updatePosition(touch);
                cloneContainer.style.display = 'none';
                const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
                cloneContainer.style.display = 'block';
                let currentTarget = elementUnder ? dropTargets.find(dt => dt.contains(elementUnder)) : null;
                if (lastTarget && lastTarget !== currentTarget) {
                    lastTarget.classList.remove('drag-over', 'drop-zone');
                }
                if (currentTarget && currentTarget !== lastTarget) {
                    let className = 'drop-zone';
                    if (currentTarget.classList.contains('card')) {
                        className = 'drag-over';
                    }
                    currentTarget.classList.add(className);
                }
                lastTarget = currentTarget;
            };
            const onTouchEnd = (e) => {
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
                cloneContainer.innerHTML = '';
                if (lastTarget) {
                    lastTarget.classList.remove('drag-over', 'drop-zone');
                }
                document.querySelectorAll('#human-hand .card.dragging').forEach(c => c.classList.remove('dragging'));
                try {
                    // ▼▼▼ AÑADE ESTA LÍNEA DE SEGURIDAD AQUÍ ▼▼▼
                    if (!lastTarget) return;
                    // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲

                    const droppedIndices = JSON.parse(dragData);
                    if (lastTarget.classList.contains('card')) {
                        const finalTouch = e.changedTouches[0];
                        const rect = lastTarget.getBoundingClientRect();
                        const midpoint = rect.left + rect.width / 2;
                        let originalIndex = parseInt(lastTarget.dataset.index);
                        let targetIndex = originalIndex;
                        if (finalTouch.clientX > midpoint) {
                            targetIndex = originalIndex + 1;
                        }
                        reorderHand(droppedIndices, targetIndex);
                    } else if (lastTarget.id === 'human-hand') {
                        const player = players[0];
                        if (!player) return;
                        const finalTouch = e.changedTouches[0];
                        const firstCard = lastTarget.firstElementChild;
                        const lastCard = lastTarget.lastElementChild;
                        let targetIndex = player.hand.length;
                        if (firstCard && lastCard) {
                            const firstCardRect = firstCard.getBoundingClientRect();
                            const lastCardRect = lastTarget.getBoundingClientRect();
                            if (finalTouch.clientX < firstCardRect.left + (firstCardRect.width / 2)) {
                                targetIndex = 0;
                            } else if (finalTouch.clientX > lastCardRect.right - (lastCardRect.width / 2)) {
                                targetIndex = player.hand.length;
                            }
                        }
                        reorderHand(droppedIndices, targetIndex);
                    } else if (lastTarget.id === 'discard') {
                        if (droppedIndices.length !== 1) { showToast('Solo puedes descartar una carta a la vez.', 2000); return; }
                        if (canDiscardByDrag()) discardCardByIndex(droppedIndices[0]);
                    } else if (lastTarget.classList.contains('center-area')) {
                        if (droppedIndices.length >= 3) {
                            // ¡Solución! Llamamos a la función que ya contiene la animación.
                            // Esto asegura un comportamiento idéntico al del botón.
                            window.attemptMeld();
                        } else {
                            showToast("Arrastra un grupo de 3 o más cartas para bajar.", 2000);
                        }
                    } else if (lastTarget.classList.contains('meld-group')) {
                        if (droppedIndices.length === 1) attemptAddCardToMeld(droppedIndices[0], parseInt(lastTarget.dataset.meldIndex));
                        else showToast("Arrastra solo una carta para añadir a una combinación existente.", 2500);
                    }
                } catch(err) {
                    console.error("Error en touch end:", err);
                    renderHands();
                }
            };
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        };

        d.addEventListener('click', () => {
            if (selectedCards.has(card.id)) {
                selectedCards.delete(card.id);
                d.classList.remove('selected');
            } else {
                selectedCards.add(card.id);
                d.classList.add('selected');
            }
            updateActionButtons();
        });

        d.addEventListener('dragstart', startDrag);
        d.addEventListener('dragend', endDrag);

        d.addEventListener('touchstart', (e) => {
            // Asegurar que el evento se asocia correctamente con este elemento
            e.stopPropagation();
            
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                
                // Crear un evento sintético que funcione mejor en móviles
                const syntheticEvent = {
                    currentTarget: d,
                    target: d,
                    touches: e.touches,
                    type: 'touchstart'
                };
                
                const dragData = startDrag(syntheticEvent);
                if (dragData) {
                    handleTouchDrag(e.touches[0], dragData);
                }
            }, 200);
        }, { passive: false });

        d.addEventListener('touchend', () => clearTimeout(longPressTimer));
        d.addEventListener('touchcancel', () => clearTimeout(longPressTimer));

        d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drag-over'); });
        d.addEventListener('dragleave', () => d.classList.remove('drag-over'));
        d.addEventListener('drop', handleDrop);
        // --- FIN DE LA LÓGICA DE EVENTOS COMPLETA ---

        return d;
    }
    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲

    function renderDiscard() {
      const pile = document.getElementById('discard');
      
      // --- OPTIMIZACIÓN: Solo configuramos los listeners si no existen ---
      if (!pile.dataset.listenersConfigured) {
        pile.ondragover = (e) => { e.preventDefault(); if (canDiscardByDrag()) pile.classList.add('drop-zone'); };
        pile.ondragleave = () => pile.classList.remove('drop-zone');
        pile.ondrop = (e) => {
          if (isWaitingForNextTurn) return;
          e.preventDefault(); pile.classList.remove('drop-zone');
          try {
              const indices = JSON.parse(e.dataTransfer.getData('application/json'));
              if (indices.length !== 1) { showToast('Solo puedes descartar una carta a la vez.', 2000); return; }
              if (canDiscardByDrag()) discardCardByIndex(indices[0]);
          } catch(err) { console.error("Error en drop de descarte:", err); }
        };
        pile.dataset.listenersConfigured = 'true';
      }
      
      // --- OPTIMIZACIÓN: Solo actualizamos si el contenido cambió ---
      let newContent;
      if (discardPile.length > 0) {
        const top = discardPile[discardPile.length-1];
        newContent = `<div class="card-image-wrapper"><img src="${getCardImageUrl(top)}" alt="${top.value} of ${getSuitName(top.suit)}" style="width: 100%; height: 100%; border-radius: inherit;"></div>`;
      } else { 
        newContent = 'Descarte<br>Vacío'; 
      }
      
      // Solo actualizamos si realmente cambió el contenido
      if (pile.innerHTML !== newContent) {
        pile.innerHTML = newContent;
      }
    }
    // ▼▼▼ REEMPLAZA TU FUNCIÓN renderMelds ENTERA CON ESTA VERSIÓN ▼▼▼
    function renderMelds() {
        const display = document.getElementById('melds-display');
        if (!display) return; // Comprobación de seguridad

        // 1. Limpiamos el contenido del contenedor en lugar de reemplazarlo.
        display.innerHTML = '';

        const combinedMelds = [...allMelds, ...turnMelds];
        const fragment = document.createDocumentFragment(); // Usamos un fragmento para mejor rendimiento

        combinedMelds.forEach(meld => {
            const g = document.createElement('div');
            g.className = 'meld-group';

            if (turnMelds.includes(meld)) {
                g.classList.add('temporary-meld');
            }

            const permanentIndex = allMelds.indexOf(meld);
            if (permanentIndex !== -1) {
                g.dataset.meldIndex = permanentIndex;
                g.ondragover = (e) => { e.preventDefault(); g.classList.add('drop-zone'); };
                g.ondragleave = () => g.classList.remove('drop-zone');
                g.ondrop = (e) => {
                    if (isWaitingForNextTurn) return;
                    e.preventDefault(); g.classList.remove('drop-zone');
                    try {
                        const cardIndices = JSON.parse(e.dataTransfer.getData('application/json'));
                        if (cardIndices.length === 1) attemptAddCardToMeld(cardIndices[0], permanentIndex);
                        else showToast("Arrastra solo una carta para añadir a una combinación existente.", 2500);
                    } catch(err) { console.error("Error al añadir carta a combinación:", err); }
                };
                const handleMeldGroupClick = (event) => {
                    event.preventDefault();
                    if (currentPlayer !== 0 || !gameStarted) return;
                    const selected = document.querySelectorAll('#human-hand .card.selected');
                    if (selected.length === 1) {
                        attemptAddCardToMeld(parseInt(selected[0].dataset.index), permanentIndex);
                    }
                };
                g.addEventListener('click', handleMeldGroupClick);
                g.addEventListener('touchend', handleMeldGroupClick);
            }

            for (let c of meld.cards) {
                const cd = document.createElement('div');
                cd.className = `card`;
                cd.dataset.cardId = c.id;
                cd.innerHTML = `<img src="${getCardImageUrl(c)}" alt="${c.value} of ${getSuitName(c.suit)}" style="width: 100%; height: 100%; border-radius: inherit; display: block;">`;
                g.appendChild(cd);
            }
            // 2. Añadimos el nuevo conjunto al fragmento.
            fragment.appendChild(g);
        });

        // 3. Añadimos todo el contenido nuevo de una sola vez al contenedor existente.
        display.appendChild(fragment);
    }
    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲
    function animateCardMovement({
        cardsData = [],
        startElement,
        endElement,
        isBack = false,
        duration = 1200, // <<-- Duración por defecto aumentada para más realismo
        rotation = 5
    }) {
        return new Promise(resolve => {
            if (!startElement || !endElement) {
                return resolve();
            }
            const startRect = startElement.getBoundingClientRect();
            const endRect = endElement.getBoundingClientRect();
            const animContainer = document.createElement('div');
            animContainer.className = 'animated-card-container';
            animContainer.style.display = 'flex';
            animContainer.style.transform = `rotate(${Math.random() * rotation * 2 - rotation}deg)`;
            const cardWidth = 90;
            const cardHeight = 135;
            const cardCount = cardsData.length || 1;
            
            // --- CORRECCIÓN: Evitar duplicación de la primera carta ---
            for(let i=0; i < cardCount; i++) {
                const cardData = cardsData[i];
                const innerCard = document.createElement('div');
                innerCard.className = 'card';
                innerCard.style.width = `${cardWidth}px`;
                innerCard.style.height = `${cardHeight}px`;
                innerCard.style.position = 'relative';
                innerCard.style.zIndex = '1000';
                
                if (isBack) {
                    innerCard.classList.add('card-back');
                } else if (cardData) {
                    innerCard.innerHTML = `<img src="${getCardImageUrl(cardData)}" alt="${cardData.value}" style="width: 100%; height: 100%; border-radius: inherit; display: block;">`;
                }
                
                // --- CORRECCIÓN: Solo aplicar margen negativo a partir de la segunda carta ---
                if (i > 0) {
                    innerCard.style.marginLeft = `-${cardWidth / 2}px`;
                }
                
                animContainer.appendChild(innerCard);
            }
            
            const totalAnimWidth = cardWidth + (cardCount - 1) * (cardWidth / 2);
            animContainer.style.left = `${startRect.left + (startRect.width / 2) - (totalAnimWidth / 2)}px`;
            animContainer.style.top = `${startRect.top + (startRect.height / 2) - (cardHeight / 2)}px`;
            animContainer.style.position = 'fixed';
            animContainer.style.zIndex = '9999';
            document.body.appendChild(animContainer);
            
            requestAnimationFrame(() => {
                animContainer.style.transition = `all ${duration}ms cubic-bezier(0.65, 0, 0.35, 1)`;
                const targetLeft = endRect.left + (endRect.width / 2) - (totalAnimWidth / 2);
                const targetTop = endRect.top + (endRect.height / 2) - (cardHeight / 2);
                const finalScale = (endElement.querySelector('.card')?.offsetWidth || 60) / cardWidth;
                animContainer.style.transform = `translate(${targetLeft - parseFloat(animContainer.style.left)}px, ${targetTop - parseFloat(animContainer.style.top)}px) scale(${finalScale}) rotate(0deg)`;
            });
            
            setTimeout(() => {
                if (animContainer.parentNode) {
                    animContainer.remove();
                }
                resolve();
            }, duration);
        });
    }
    function getSuitName(s) { if(s==='hearts')return'Corazones'; if(s==='diamonds')return'Diamantes'; if(s==='clubs')return'Tréboles'; if(s==='spades')return'Picas'; return ''; }
    function getSuitIcon(s) { if(s==='hearts')return'♥'; if(s==='diamonds')return'♦'; if(s==='clubs')return'♣'; if(s==='spades')return'♠'; return ''; }
    function updateTurnIndicator() { for (let i = 0; i < 4; i++) { const e = document.getElementById(`info-player${i}`); if(e) e.classList.remove('current-turn-glow'); } const e = document.getElementById(`info-player${currentPlayer}`); if(e) e.classList.add('current-turn-glow'); }
    function updatePointsIndicator() { } function updateDebugInfo() { } let hidePlayerActionToasts = true; function showPlayerToast(msg, duration=3000) { if (hidePlayerActionToasts) return; showToast(msg, duration); } function showOverlay(id) { document.getElementById(id).style.display = 'flex'; } function hideOverlay(id) { document.getElementById(id).style.display = 'none'; }
    // Pega esta función completa en tu game.js
    function createCardDisplayHTML(cards) {
        if (!cards || cards.length === 0) return '';
        return cards.map(card => `
            <div class="card" style="position: relative; display: inline-block;">
                <img src="${getCardImageUrl(card)}" alt="${card.value}" style="width: 100%; height: 100%; display: block;">
            </div>
        `).join('');
    }

    // Reemplaza la función showEliminationMessage entera
    function showEliminationMessage(playerName, faultData) {
        const el = document.getElementById('elimination-message');
        const faultDetailsContainer = document.getElementById('fault-details-container');
        const invalidComboContainer = document.getElementById('invalid-combo-container');
        const correctComboContainer = document.getElementById('correct-combo-container');
        const invalidDisplay = document.getElementById('invalid-combo-display');
        const correctDisplay = document.getElementById('correct-combo-display');

        if (!el || !faultDetailsContainer) return;

        // 1. Mostrar el mensaje de texto principal
        const penalty = currentGameSettings?.settings?.penalty || 0;
        const tableCurrency = currentGameSettings?.settings?.betCurrency || 'USD';
        let penaltyText = `${penalty.toLocaleString('es-CO')} ${tableCurrency}`;

        if (currentUser.currency && tableCurrency !== currentUser.currency) {
            const convertedPenalty = convertCurrency(penalty, tableCurrency, currentUser.currency, clientExchangeRates);
            const symbol = currentUser.currency === 'EUR' ? '€' : currentUser.currency;
            penaltyText += ` <span style="font-size: 0.9rem; color: #aaa;">(Aprox. ${convertedPenalty.toFixed(2)} ${symbol})</span>`;
        }

        el.innerHTML = `Jugador <strong>${playerName}</strong> ha sido eliminado y pagará la multa adicional de <strong>${penaltyText}</strong> por la siguiente falta:
            <div style="background: rgba(255,0,0,0.1); border: 1px solid #ff4444; padding: 10px; border-radius: 8px; margin-top: 15px; font-size: 1.1em; color: #ffdddd; text-align: center;">
                ${faultData.reason}
            </div>`;

        // 2. Lógica para mostrar las cartas
        faultDetailsContainer.style.display = 'none';
        invalidComboContainer.style.display = 'none';
        correctComboContainer.style.display = 'none';

        // PEGA ESTA VERSIÓN CORREGIDA EN SU LUGAR
        if (faultData.invalidCards) {
            // ▼▼▼ INICIO DE LA MODIFICACIÓN ▼▼▼
            if (faultData.contextCards && faultData.faultType === 'invalid_add') {
                // CASO NUEVO: Intento de AÑADIR una carta inválida
                // Contenedor 1: Muestra la CARTA que se intentó añadir.
                invalidComboContainer.querySelector('h4').textContent = 'Carta Añadida Ilegalmente:';
                invalidDisplay.innerHTML = createCardDisplayHTML(faultData.invalidCards);
                invalidComboContainer.style.display = 'block';

                // Contenedor 2: Muestra EL JUEGO al que se intentó añadir.
                correctComboContainer.querySelector('h4').textContent = 'Juego en Mesa (Objetivo):';
                correctDisplay.innerHTML = createCardDisplayHTML(faultData.contextCards);
                correctComboContainer.style.display = 'block';
            
            } else if (faultData.contextCards) { // CASO: Descarte Ilegal (El original)
            // ▼▼▼ FIN DE LA MODIFICACIÓN ▼▼▼
                // Contenedor 1: Muestra LA CARTA que se intentó descartar.
                invalidComboContainer.querySelector('h4').textContent = 'Carta Descartada Ilegalmente:';
                invalidDisplay.innerHTML = createCardDisplayHTML(faultData.invalidCards);
                invalidComboContainer.style.display = 'block';

                // Contenedor 2: Muestra EL JUEGO en mesa donde se podía añadir.
                correctComboContainer.querySelector('h4').textContent = 'Se Podía Añadir a este Juego:';
                correctDisplay.innerHTML = createCardDisplayHTML(faultData.contextCards);
                correctComboContainer.style.display = 'block';

            } else { // CASO: Bajada Inválida (lógica anterior se mantiene)
                invalidComboContainer.querySelector('h4').textContent = 'Combinación Inválida Presentada:';
                invalidDisplay.innerHTML = createCardDisplayHTML(faultData.invalidCards);
                invalidComboContainer.style.display = 'block';

                if (faultData.correctCards) {
                    correctComboContainer.querySelector('h4').textContent = 'Forma Correcta Sugerida:';
                    correctDisplay.innerHTML = createCardDisplayHTML(faultData.correctCards);
                    correctComboContainer.style.display = 'block';
                }
            }
            faultDetailsContainer.style.display = 'block';
        }

        showOverlay('elimination-overlay');
    }
    // Nota: La variable shouldRedirectToLobbyAfterElimination está declarada al inicio del archivo (línea ~240)
    
    // ▼▼▼ REEMPLAZA LA FUNCIÓN ENTERA CON ESTA VERSIÓN ▼▼▼
    // ▼▼▼ REEMPLAZA ESTA FUNCIÓN COMPLETA ▼▼▼
    window.closeEliminationOverlay = function() { 
        console.log('[closeEliminationOverlay] Cerrando modal de eliminación. shouldRedirectToLobbyAfterElimination:', shouldRedirectToLobbyAfterElimination);
        hideOverlay('elimination-overlay'); 
        
        // ▼▼▼ SI DEBE REDIRIGIR AL LOBBY (jugador eliminado por inactividad) ▼▼▼
        if (shouldRedirectToLobbyAfterElimination) {
            console.log('⚠️ Redirigiendo al lobby después de cerrar el modal de eliminación...');
            const gameType = eliminationGameType || 'la51'; // Por defecto La 51 si no se detectó
            shouldRedirectToLobbyAfterElimination = false; // Resetear la bandera
            eliminationGameType = null; // Resetear el tipo de juego
            
            // ▼▼▼ LIMPIEZA AGRESIVA DEL ESTADO Y VISTA DEL JUEGO ▼▼▼
            // Asegurar que el estado esté limpio
            resetClientGameState();
            currentGameSettings = null;
            
            // Ocultar TODOS los elementos del juego de forma agresiva
            const gameContainer = document.getElementById('game-container');
            if (gameContainer) {
                gameContainer.style.display = 'none';
                gameContainer.style.visibility = 'hidden';
            }
            
            // Remover clase game-active del body
            document.body.classList.remove('game-active');
            
            // Ocultar cualquier overlay o modal del juego
            const victoryOverlay = document.getElementById('victory-overlay');
            if (victoryOverlay) {
                victoryOverlay.style.display = 'none';
            }
            
            // Asegurar que el lobby overlay esté visible
            const lobbyOverlay = document.getElementById('lobby-overlay');
            if (lobbyOverlay) {
                lobbyOverlay.style.display = 'flex';
            }
            // ▲▲▲ FIN DE LIMPIEZA AGRESIVA ▲▲▲
            
            // ▼▼▼ REDIRIGIR AL LOBBY CORRECTO SEGÚN EL TIPO DE JUEGO ▼▼▼
            if (gameType === 'ludo') {
                // Si estaba jugando Ludo o Parchís, redirigir al lobby de Ludo
                console.log('[closeEliminationOverlay] Redirigiendo al lobby de Ludo/Parchís');
                
                // ▼▼▼ REDIRECCIÓN OBLIGATORIA EN TODOS LOS DISPOSITIVOS (MÓVIL, PWA, NAVEGADOR) ▼▼▼
                // Detectar si es móvil o PWA
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || document.referrer.includes('android-app://');
                
                // SIEMPRE usar redirección directa para asegurar que funcione en todos los dispositivos
                console.log('[closeEliminationOverlay] Redirección OBLIGATORIA a /ludo/ (móvil:', isMobile, ', PWA:', isPWA, ')');
                
                // Notificar al servidor antes de redirigir (si el socket está conectado)
                if (socket && socket.connected) {
                    socket.emit('enterLudoLobby');
                    console.log('[closeEliminationOverlay] Evento enterLudoLobby emitido');
                }
                
                // Redirección directa OBLIGATORIA (funciona en móvil, PWA y navegador)
                setTimeout(() => {
                    window.location.href = '/ludo/';
                }, 100);
                // ▲▲▲ FIN DE REDIRECCIÓN OBLIGATORIA ▲▲▲
            } else {
                // Si estaba jugando La 51, redirigir al lobby de La 51
                console.log('[closeEliminationOverlay] Redirigiendo al lobby de La 51');
                
                // ▼▼▼ REDIRECCIÓN OBLIGATORIA EN TODOS LOS DISPOSITIVOS (MÓVIL, PWA, NAVEGADOR) ▼▼▼
                // Detectar si es móvil o PWA
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || document.referrer.includes('android-app://');
                
                // SIEMPRE usar redirección directa para asegurar que funcione en todos los dispositivos
                console.log('[closeEliminationOverlay] Redirección OBLIGATORIA a /la51/ (móvil:', isMobile, ', PWA:', isPWA, ')');
                
                // Notificar al servidor antes de redirigir (si el socket está conectado)
                if (socket && socket.connected) {
                    socket.emit('enterLa51Lobby');
                    console.log('[closeEliminationOverlay] Evento enterLa51Lobby emitido');
                }
                
                // Redirección directa OBLIGATORIA (funciona en móvil, PWA y navegador)
                setTimeout(() => {
                    window.location.href = '/la51/';
                }, 100);
                // ▲▲▲ FIN DE REDIRECCIÓN OBLIGATORIA ▲▲▲
            }
            // ▲▲▲ FIN DE REDIRECCIÓN AL LOBBY CORRECTO ▲▲▲
            
            return; // Salir temprano, no procesar más
        }
        // ▲▲▲ FIN DE REDIRECCIÓN AL LOBBY ▲▲▲
        
        // Verificamos si la partida de práctica terminó por nuestra falta.
        if (practiceGameEndedByHumanFault) {
            practiceGameEndedByHumanFault = false; // Reseteamos la bandera para futuras partidas.
            showOverlay('practice-restart-modal'); // Mostramos el modal de reinicio.
        }
    }
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
    // ▼▼▼ ELIMINA ESTA FUNCIÓN COMPLETA ▼▼▼
    /*
    async function animateShuffleIfNeeded(newDeckSize) {
      if (newDeckSize > 0 && newDeckSize < 10) { 
          await animateShuffle();
      }
    }
    */
    // ▲▲▲ FIN DE LA FUNCIÓN A ELIMINAR ▲▲▲
    async function animateShuffle() {
      return new Promise(resolve => {
        const centerArea = document.querySelector('.center-area');
        if (!centerArea) {
          resolve();
          return;
        }
        showToast('Mazo vacío. Barajando el descarte...', 5000);
        const container = document.createElement('div');
        container.className = 'shuffling-animation-container';
        for (let i = 0; i < 8; i++) {
          const card = document.createElement('div');
          card.className = 'card-back-anim';
          card.style.animationDelay = `${i * 0.1}s`;
          container.appendChild(card);
        }
        centerArea.appendChild(container);
        setTimeout(() => {
          container.remove();
          resolve();
        }, 5000);
      });
    }
    
    function canDiscardByDrag() { return currentPlayer === 0 && gameStarted && (hasDrawn || mustDiscard); }

    window.drawFromDeck = function() {
        if (isDrawing || isWaitingForNextTurn) return; // Previene dobles clics o acciones mientras se espera al servidor
        isDrawing = true; 
        console.log("Solicitando carta al servidor desde el mazo...");
        socket.emit('drawFromDeck', currentGameSettings.roomId);
    }

    window.drawFromDiscard = async function() {
        if (isDrawing || isWaitingForNextTurn) return; // Previene dobles clics o acciones mientras se espera al servidor
        if (discardPile.length === 0) {
            showToast('El descarte está vacío', 1500);
            return;
        }
        isDrawing = true; 
        console.log("Solicitando carta al servidor desde el descarte...");
        socket.emit('drawFromDiscard', currentGameSettings.roomId);
    }
    window.attemptMeld = function() {
        if (isWaitingForNextTurn || currentPlayer !== 0 || !gameStarted) return;
        const selectedElements = document.querySelectorAll('#human-hand .card.selected');
        if (selectedElements.length < 3) {
            showToast('Selecciona al menos 3 cartas para bajar.', 1800);
            return;
        }

        const cardIds = Array.from(selectedElements).map(el => el.dataset.cardId);
        const cardsData = cardIds.map(id => players[0].hand.find(c => c.id === id)).filter(Boolean);
        const meldsContainer = document.getElementById('melds-display');

        if (cardsData.length === cardIds.length && meldsContainer) {
            isAnimatingLocalMeld = true; // <-- 1. Activamos la bandera
            const placeholder = document.createElement('div');
            placeholder.className = 'meld-group';
            placeholder.style.visibility = 'hidden';
            meldsContainer.appendChild(placeholder);

            animateCardMovement({
                cardsData: cardsData,
                startElement: document.getElementById('human-hand'),
                endElement: placeholder,
                duration: 1200
            }).then(() => {
                // <-- 3. Esto se ejecuta DESPUÉS de la animación
                if (meldsContainer.contains(placeholder)) {
                    meldsContainer.removeChild(placeholder);
                }
                isAnimatingLocalMeld = false; // Desactivamos la bandera
                renderHands(); // Forzamos el redibujado final y limpio
            });
        }

        // <-- 2. Enviamos la acción al servidor INMEDIATAMENTE
        socket.emit('meldAction', {
            roomId: currentGameSettings.roomId,
            cardIds: cardIds
        });
    }
    function setupMeldDropZone() {
        const meldZone = document.querySelector('.center-area');
        meldZone.addEventListener('dragover', (e) => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData('application/json')); if (Array.isArray(data) && data.length >= 3) meldZone.classList.add('drop-zone'); } catch(e) {} });
        meldZone.addEventListener('dragleave', () => meldZone.classList.remove('drop-zone'));
        meldZone.addEventListener('drop', (e) => {
            if (isWaitingForNextTurn) return;
            e.preventDefault(); meldZone.classList.remove('drop-zone');
            try {
                const indices = JSON.parse(e.dataTransfer.getData('application/json'));
                if (Array.isArray(indices) && indices.length >= 3) {
                    const p = players[0];
                    if (!p || !p.hand) return;

                    const cardIds = indices.map(index => {
                        const card = p.hand[index];
                        return card && card.id ? card.id : null;
                    }).filter(Boolean);
                    if (cardIds.length !== indices.length) return;

                    // --- INICIO DE LA LÓGICA DE ANIMACIÓN AÑADIDA ---
                    const cardsData = cardIds.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
                    const meldsContainer = document.getElementById('melds-display');

                    if (cardsData.length === cardIds.length && meldsContainer) {
                        isAnimatingLocalMeld = true;
                        const placeholder = document.createElement('div');
                        placeholder.className = 'meld-group';
                        placeholder.style.visibility = 'hidden';
                        meldsContainer.appendChild(placeholder);

                        animateCardMovement({
                            cardsData: cardsData,
                            startElement: document.getElementById('human-hand'),
                            endElement: placeholder,
                            duration: 1200
                        }).then(() => {
                            if (meldsContainer.contains(placeholder)) {
                                meldsContainer.removeChild(placeholder);
                            }
                            isAnimatingLocalMeld = false;
                            renderHands();
                        });
                    }
                    // --- FIN DE LA LÓGICA DE ANIMACIÓN AÑADIDA ---

                    socket.emit('meldAction', {
                        roomId: currentGameSettings.roomId,
                        cardIds: cardIds
                    });

                } else {
                    showToast("Arrastra un grupo de 3 o más cartas para bajar.", 2000);
                }
            } catch (err) {
                console.error("Error al soltar para combinar:", err);
            }
        });
        const handleMeldZoneClick = (event) => {
            event.preventDefault(); // Prevenimos cualquier comportamiento por defecto
            
            // Buscamos el botón "Bajar Conjunto"
            const meldBtn = document.getElementById('meld-btn');
            
            // Si el botón existe y NO está deshabilitado, lo "clickeamos"
            if (meldBtn && !meldBtn.disabled) {
                meldBtn.click();
            }
        };
        meldZone.addEventListener('click', handleMeldZoneClick);
        meldZone.addEventListener('touchend', handleMeldZoneClick);
    }
    window.attemptDiscard = async function() {
        if (isWaitingForNextTurn) {
            // Mensaje eliminado: "Esperando tu turno..."
            return;
        }
        if (currentPlayer !== 0) {
            // Mensaje eliminado: "No es tu turno"
            return;
        }
        const p = players[currentPlayer];
        if (!p || p.isBot || !gameStarted) {
            // Mensaje eliminado: "No es tu turno"
            return;
        }
        if (!hasDrawn && !mustDiscard) {
            showToast('Debes robar antes de descartar', 2000);
            return;
        }
        const selected = document.querySelectorAll('#human-hand .card.selected');
        if (selected.length === 0) {
            showToast('Toca una carta en tu mano para seleccionarla y luego toca el descarte.', 3000);
            return;
        }
        if (selected.length > 1) {
            showToast('Selecciona solo una carta para descartar.', 2000);
            return;
        }
        // La validación de los 51 puntos ha sido eliminada. El servidor se encargará de ello.
        await discardCardByIndex(parseInt(selected[0].dataset.index));
    }
    
    function showFault(message) {
        showToast('FALTA: ' + message, 3500);
        socket.emit('playerFault', {
            roomId: currentGameSettings.roomId,
            faultReason: message
        });
    }


    function attemptAddCardToMeld(cardIndex, meldIndex) {
        if (isWaitingForNextTurn || currentPlayer !== 0 || !gameStarted) return;
        const p = players[0];
        if (!p || cardIndex < 0 || cardIndex >= p.hand.length) return;

        const card = p.hand[cardIndex];
        const startElement = document.querySelector(`#human-hand .card[data-index='${cardIndex}']`);
        const endElement = document.querySelector(`.meld-group[data-meld-index='${meldIndex}']`);

        // --- INICIO: Lógica de animación e iluminación local ---
        if (startElement && endElement) {
            animateCardMovement({
                cardsData: [card],
                startElement: startElement,
                endElement: endElement,
                duration: 1000 // <-- CAMBIA 700 POR 1000
            }).then(() => {
                // Iluminar la combinación al instante
                endElement.classList.add('card-illuminated');
                setTimeout(() => endElement.classList.remove('card-illuminated'), 2500);
            });
        }
        // --- FIN: Lógica de animación e iluminación local ---

        socket.emit('meldAction', { 
            roomId: currentGameSettings.roomId, 
            cardIds: [card.id],
            targetMeldIndex: meldIndex
        });
    }
    function setupRematchScreen() {
        // ▲ ...CON ESTE NUEVO BLOQUE ▼
        const wasPlayerInGame = orderedSeats.some(s => s && s.playerId === socket.id);
        if (!wasPlayerInGame) {
            // Si el usuario NO estaba en un asiento (ni jugando ni esperando), es un espectador puro.
            addChatMessage(null, 'La partida ha terminado. Puedes quedarte a ver la revancha.', 'system');
            return; // No mostramos NINGÚN overlay de revancha para él.
        }

        hideOverlay('victory-overlay');

        const readyOverlay = document.getElementById('ready-overlay');
        const welcomeMsg = document.getElementById('welcome-message');
        const mainButton = document.getElementById('btn-ready-main');
        const spectatorButton = document.getElementById('btn-spectator-sit');
        const rematchStatusEl = document.getElementById('rematch-status');

        welcomeMsg.textContent = 'Sala de Revancha';

        // --- INICIO DE LA LÓGICA DE CORRECCIÓN ---

        // 1. Identificamos el rol del jugador en la partida que acaba de terminar.
        const wasWaitingPlayer = orderedSeats.some(s => s && s.playerId === socket.id && s.status === 'waiting');
        const wasActivePlayer = orderedSeats.some(s => s && s.playerId === socket.id && s.status !== 'waiting');

        // Por defecto, mostramos el estado de espera.
        rematchStatusEl.innerHTML = '<p>Esperando confirmación de los jugadores...</p>';

        if (wasWaitingPlayer) {
            // CASO A: El jugador ya estaba en la lista de espera.
            // No necesita confirmar nada. Ocultamos todos los botones.
            mainButton.style.display = 'none';
            spectatorButton.style.display = 'none';
            rematchStatusEl.innerHTML = '<p>Ya estás listo para la siguiente partida. Esperando al anfitrión...</p>';

        } else if (wasActivePlayer) {
            // CASO B: El jugador participó activamente en la partida.
            // Le mostramos el botón para confirmar la revancha.
            mainButton.style.display = 'block';
            spectatorButton.style.display = 'none';
            mainButton.textContent = 'Confirmar Revancha';
            mainButton.disabled = false;
            mainButton.onclick = () => {
                // 1. Calcular créditos necesarios con conversión de moneda
                const roomSettings = currentGameSettings.settings;
                const requirementInRoomCurrency = (roomSettings.bet || 0) + (roomSettings.penalty || 0);
                const roomCurrency = roomSettings.betCurrency || 'USD';
                const userCredits = currentUser.credits ?? 0;
                const userCurrency = currentUser.currency || 'USD';

                let requiredInUserCurrency = convertCurrency(requirementInRoomCurrency, roomCurrency, userCurrency, clientExchangeRates);

                // 2. Validar si los créditos son suficientes
                if (userCredits >= requiredInUserCurrency) {
                    // SI TIENE CRÉDITOS: Se une a la revancha
                    mainButton.disabled = true;
                    mainButton.textContent = 'Esperando a los demás...';
                    addChatMessage(null, 'Has confirmado la revancha. Esperando...', 'system');
                    socket.emit('requestRematch', { roomId: currentGameSettings.roomId });
                } else {
                    // NO TIENE CRÉDITOS: Muestra el modal de error
                    hideOverlay('ready-overlay'); // Ocultar el modal de revancha
                    const missingAmount = requiredInUserCurrency - userCredits;
                    const friendlyRequired = `${requiredInUserCurrency.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrency}`;
                    const friendlyMissing = `${missingAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrency}`;

                    showRematchFundsModal(friendlyRequired, friendlyMissing);
                }
            };
        } else {
            // CASO C: Es un espectador que acaba de llegar (no estaba ni activo ni en espera).
            // Le mostramos el botón para sentarse por primera vez.
            mainButton.style.display = 'none';
            spectatorButton.style.display = 'block';
            spectatorButton.disabled = false;
            spectatorButton.textContent = '✔️ Unirse a la Próxima Partida';
            spectatorButton.onclick = () => {
                socket.emit('requestToSit', currentGameSettings.roomId);
                hideOverlay('ready-overlay'); // Ocultar modal tras confirmar
            };
        }
        // --- FIN DE LA LÓGICA DE CORRECCIÓN ---

        showOverlay('ready-overlay');
    }
    function updateActionButtons() {
      const meldBtn = document.getElementById('meld-btn'); const discardBtn = document.getElementById('discard-btn');
      
      if (isWaitingForNextTurn) {
          meldBtn.disabled = true;
          discardBtn.disabled = true;
          discardBtn.classList.remove('ready');
          return;
      }

      if (!gameStarted || currentPlayer !== 0 || !players[0]) { meldBtn.disabled = true; discardBtn.disabled = true; return; }
      const selected = document.querySelectorAll('#human-hand .card.selected');
      meldBtn.disabled = selected.length < 3;
      const canDisc = (selected.length === 1) && (hasDrawn || mustDiscard);
      discardBtn.disabled = !canDisc;
      if(canDisc) discardBtn.classList.add('ready'); else discardBtn.classList.remove('ready');
    }


    console.log('Script de juego cargado.');
})();
// --- FIN: SCRIPT DEL JUEGO ---
// ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AL FINAL DE game.js ▼▼▼

// Variable global para controlar el estado del sonido
let isMuted = false;
let audioInitialized = false; // <-- NUEVA LÍNEA

/**
 * Desbloquea el contexto de audio para iOS.
 * Debe ser llamado por la primera interacción del usuario.
 */
function initAudioContext() {
    // Si ya se inicializó, no hacemos nada.
    if (audioInitialized) return;

    const soundContainer = document.getElementById('game-sounds');
    if (soundContainer) {
        const audioElements = soundContainer.querySelectorAll('audio');
        console.log(`[Audio] Intentando desbloquear ${audioElements.length} sonidos para iOS...`);
        
        audioElements.forEach(audio => {
            
            // --- INICIO DEL REFUERZO ---
            // (REFUERZO) Forzamos la carga del audio primero.
            audio.load();
            // --- FIN DEL REFUERZO ---

            // Intentamos reproducir y pausar inmediatamente.
            const promise = audio.play();
            if (promise !== undefined) {
                promise.then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                }).catch(error => {
                    // Es normal que esto falle si el navegador lo bloquea,
                    // pero el simple intento de .play() suele ser suficiente.
                });
            }
        });
    }
    
    audioInitialized = true;
    
    // Eliminamos los listeners para que no se ejecuten más
    document.removeEventListener('click', initAudioContext, true);
    document.removeEventListener('touchend', initAudioContext, true);
    
    // (REFUERZO) Quitamos los listeners de los botones también
    const btnLogin = document.getElementById('btn-login');
    if(btnLogin) {
        btnLogin.removeEventListener('click', initAudioContext);
    }
}

// Asignamos los listeners para la primera interacción del usuario
// Usamos 'true' (captura) para asegurarnos de que se ejecute
// antes que cualquier otro evento de clic (como el del botón de login).
document.addEventListener('click', (e) => {
    // No interferir con el botón "Cambiar de Juego"
    if (e.target.closest('.button.secondary[onclick*="/select"]')) {
        return;
    }
    initAudioContext();
}, true);
document.addEventListener('touchend', (e) => {
    // No interferir con el botón "Cambiar de Juego"
    if (e.target.closest('.button.secondary[onclick*="/select"]')) {
        return;
    }
    initAudioContext();
}, true);

/**
 * Cambia el estado de silencio, actualiza el icono y guarda la preferencia.
 */
function toggleMute() {
    isMuted = !isMuted; // Invierte el estado (true -> false, false -> true)
    localStorage.setItem('la51_sound_muted', isMuted); // Guarda la preferencia
    updateSoundButtonUI();
}

/**
 * Actualiza la apariencia del botón según el estado de 'isMuted'.
 */
function updateSoundButtonUI() {
    const soundButton = document.getElementById('btn-toggle-sound');
    if (soundButton) {
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

// Lógica de inicialización que se ejecuta cuando la página carga
document.addEventListener('DOMContentLoaded', () => {
    const soundButton = document.getElementById('btn-toggle-sound');
    if (soundButton) {
        // 1. Cargar la preferencia guardada del usuario
        const savedMutePreference = localStorage.getItem('la51_sound_muted') === 'true';
        isMuted = savedMutePreference;

        // 2. Actualizar el botón para que refleje el estado inicial
        updateSoundButtonUI();

        // 3. Asignar la función de 'toggle' al clic del botón
        soundButton.addEventListener('click', toggleMute);
    }
});

// ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

// ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AL FINAL DE game.js ▼▼▼

/**
 * Configura el registro del Service Worker y el sistema de notificación de actualizaciones.
 */
function setupPwaUpdateNotifications() {
    // DESHABILITADO COMPLETAMENTE: El Service Worker causa problemas de navegación en móviles
    // Desregistramos cualquier Service Worker existente para evitar bloqueos
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(registration => {
                registration.unregister().then(() => {
                    console.log('Service Worker desregistrado para evitar bloqueos');
                });
            });
        });
    }
}

// Ejecutamos la configuración cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', setupPwaUpdateNotifications);

// ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲// Cache bust: Tue Oct  7 11:46:02 WEST 2025

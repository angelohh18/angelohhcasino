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

// ▼▼▼ AÑADE ESTA FUNCIÓN AL PRINCIPIO DE game.js ▼▼▼
// La variable 'isMuted' la definiremos más abajo
function playSound(soundId) {
    // ¡Línea clave! Si está silenciado, no hace nada.
    if (isMuted) return;

    try {
        const soundElement = document.getElementById(`sound-${soundId}`);
        if (soundElement) {
            soundElement.currentTime = 0;
            soundElement.play();
        }
    } catch (error) {
        console.warn(`No se pudo reproducir el sonido: ${soundId}`, error);
    }
}
// ▲▲▲ FIN DE LA FUNCIÓN A AÑADIR ▲▲▲

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
    modal.style.display = 'block';
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

    modal.style.display = 'block';
}

// --- INICIO: SCRIPT DE PUENTE (BRIDGE) ---

// ▼▼▼ PEGA LA FUNCIÓN COMPLETA AQUÍ ▼▼▼
function showToast(msg, duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.error("Elemento 'toast' no encontrado en el DOM.");
        return;
    }
    toast.textContent = msg;
    toast.classList.add('show');
    // Usamos un temporizador para ocultar el toast después de la duración
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}
// ▲▲▲ FIN DEL CÓDIGO A PEGAR ▲▲▲

function showLobbyView() {
    document.body.classList.remove('game-active'); // >> AÑADE ESTA LÍNEA <<
    document.getElementById('lobby-overlay').style.display = 'flex';
    document.getElementById('game-container').style.display = 'none';
    hideOverlay('ready-overlay'); // Asegurarse que el overlay se oculte al volver
    
    // Asegurar que el modal de creación de mesa esté oculto
    if (typeof forceHideCreateRoomModal === 'function') {
        forceHideCreateRoomModal();
    } else if (typeof window.forceHideCreateRoomModal === 'function') {
        window.forceHideCreateRoomModal();
    } else {
        const createRoomModal = document.getElementById('create-room-modal');
        if (createRoomModal) {
            createRoomModal.style.display = 'none';
            createRoomModal.setAttribute('data-forced-hidden', 'true');
        }
    }
    
    if (typeof scaleAndCenterLobby === 'function') {
        scaleAndCenterLobby();
    }
    if (typeof updateLobbyCreditsDisplay === 'function') {
        updateLobbyCreditsDisplay();
    }
    
    // Doble verificación después de un pequeño delay
    setTimeout(() => {
        if (typeof forceHideCreateRoomModal === 'function') {
            forceHideCreateRoomModal();
        } else if (typeof window.forceHideCreateRoomModal === 'function') {
            window.forceHideCreateRoomModal();
        }
    }, 100);
}

function showGameView(settings) {
    // Redirige al jugador a la página del juego con el ID de la sala
    // window.location.href = `/ludo.html?roomId=${settings.roomId}`; // <-- ELIMINA ESTO
    window.location.href = `/ludo-game?roomId=${settings.roomId}`; // <-- AÑADE ESTO
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

const socket = io({ autoConnect: false }); // Cambiado de '/ludo' a namespace por defecto para sincronización correcta

let spectatorMode = 'wantsToPlay'; // Variable global para controlar el modo espectador
let clientExchangeRates = {}; // Para guardar las tasas
let lastKnownRooms = []; // <-- AÑADE ESTA LÍNEA
let isJoiningLudoRoom = false; // <-- AÑADE ESTA LÍNEA


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
});


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
            modal.style.display = 'block';

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
    // ▼▼▼ CRÍTICO: Verificar y restaurar userId desde sessionStorage o localStorage (para PWA) ▼▼▼
    let savedUserId = sessionStorage.getItem('userId') || localStorage.getItem('userId');
    let savedUsername = sessionStorage.getItem('username') || localStorage.getItem('username');
    
    if (savedUsername && !savedUserId) {
        savedUserId = 'user_' + savedUsername.toLowerCase();
        // Guardar en ambos para persistencia
        sessionStorage.setItem('userId', savedUserId);
        localStorage.setItem('userId', savedUserId);
        console.log('[Lobby] userId restaurado desde username:', savedUserId);
    } else if (savedUserId) {
        // Asegurarse de que esté en ambos lugares
        sessionStorage.setItem('userId', savedUserId);
        localStorage.setItem('userId', savedUserId);
    }
    // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    
    // Notificar al servidor que estamos en el lobby de Ludo
    if (socket.connected) {
        socket.emit('enterLudoLobby');
        // Si hay un usuario logueado, solicitar estado actualizado
        if (savedUsername) {
            socket.emit('userLoggedIn', { username: savedUsername, currency: sessionStorage.getItem('userCurrency') || 'USD' });
        }
    } else {
        socket.on('connect', () => {
            socket.emit('enterLudoLobby');
            // Si hay un usuario logueado, solicitar estado actualizado
            if (savedUsername) {
                socket.emit('userLoggedIn', { username: savedUsername, currency: sessionStorage.getItem('userCurrency') || 'USD' });
            }
        });
    }

    socket.on('updateLudoRoomList', (serverRooms) => {
        console.log('[CLIENTE LUDO] Recibida lista de salas de Ludo:', serverRooms ? serverRooms.length : 0, 'salas');
        lastKnownRooms = serverRooms || [];
        renderRoomsOverview(lastKnownRooms);
    });

    socket.on('userStateUpdated', (userState) => {
        console.log('Estado de usuario actualizado:', userState);
        currentUser.credits = userState.credits;
        currentUser.currency = userState.currency;
        
        // ▼▼▼ CRÍTICO: Actualizar también sessionStorage Y localStorage para mantener consistencia ▼▼▼
        if (userState.credits !== undefined) {
            // Guardar créditos en sessionStorage y localStorage para persistencia
            sessionStorage.setItem('userCredits', userState.credits.toString());
            localStorage.setItem('userCredits', userState.credits.toString());
        }
        if (userState.currency) {
            sessionStorage.setItem('userCurrency', userState.currency);
            localStorage.setItem('userCurrency', userState.currency);
        }
        // Preservar username y avatar si están incluidos
        if (userState.username) {
            sessionStorage.setItem('username', userState.username);
            localStorage.setItem('username', userState.username);
            currentUser.username = userState.username;
        }
        if (userState.avatar) {
            sessionStorage.setItem('userAvatar', userState.avatar);
            localStorage.setItem('userAvatar', userState.avatar);
            currentUser.userAvatar = userState.avatar;
            // Actualizar el avatar en la UI si existe
            const userAvatarEl = document.getElementById('user-avatar');
            if (userAvatarEl) {
                userAvatarEl.src = userState.avatar;
            }
        }
        // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲

        if (typeof updateLobbyCreditsDisplay === 'function') {
            updateLobbyCreditsDisplay();
        }
        
        renderRoomsOverview(lastKnownRooms); 
    });

    // ▼▼▼ ¡AÑADE ESTE LISTENER COMPLETO! ▼▼▼
    socket.on('ludoGameState', (state) => {
        // ▼▼▼ ¡AÑADE ESTE LOG PRIMERO! ▼▼▼
        console.error("--- !!! [Lobby] ludoGameState EVENT RECEIVED (Raw) !!! ---", state ? state.roomId : 'No State Object', state ? state.mySeatIndex : 'N/A');
        // ▲▲▲ FIN ▲▲▲
        
        // ▼▼▼ ¡AÑADE ESTE LOG AQUÍ! ▼▼▼
        console.error("--- !!! [Lobby] ludoGameState EVENT RECEIVED !!! ---", state); 
        // ▲▲▲ FIN ▲▲▲

        // Este evento llega después de unirse exitosamente a una sala LUDO
        console.log('[Lobby] Recibido ludoGameState. Verificando si se estaba uniendo...');

        // Si la bandera está activa, significa que acabamos de unirnos desde el lobby
        if (isJoiningLudoRoom) {
            console.log('   -> Sí, se estaba uniendo. Redirigiendo a ludo.html...');
            isJoiningLudoRoom = false; // Resetea la bandera

            // Llama a la función que SÍ hace la redirección
            showGameView({ roomId: state.roomId }); // Solo necesitamos el roomId para la URL
        } else {
            console.log('   -> No, probablemente es una actualización para un juego ya en curso (ignorado en lobby).');
            // No hacemos nada si no estábamos en proceso de unirnos (evita redirecciones accidentales)
        }
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // ▼▼▼ FUNCIÓN PARA RENDERIZAR LISTA DE JUGADORES ▼▼▼
    function renderOnlineUsers(userList = []) {
        const listElement = document.getElementById('online-users-list');
        if (!listElement) return;

        listElement.innerHTML = ''; // Limpia la lista actual

        // Ordena la lista alfabéticamente por nombre de usuario
        userList.sort((a, b) => a.username.localeCompare(b.username));

        userList.forEach(user => {
            const li = document.createElement('li');
            // Determinar la clase CSS basándose en si está jugando
            const statusClass = user.status && user.status.includes('Jugando') ? 'status-playing' : 'status-lobby';
            
            // Construir el texto del estado (ya viene formateado del servidor)
            let statusText = user.status || 'En el Lobby';
            
            li.innerHTML = `
                <span>${user.username}</span>
                <span class="user-status ${statusClass}" title="${statusText}">${statusText}</span>
            `;
            listElement.appendChild(li);
        });
    }
    // ▲▲▲ FIN: FUNCIÓN AÑADIDA ▲▲▲

    // ▼▼▼ LISTENER PARA ACTUALIZAR LISTA DE USUARIOS ▼▼▼
    socket.on('updateUserList', (userList) => {
        renderOnlineUsers(userList);
    });
    // ▲▲▲ FIN: LISTENER AÑADIDO ▲▲▲

    // ▼▼▼ LISTENERS DEL CHAT DEL LOBBY DE LUDO (SEPARADOS) ▼▼▼
    // Eliminar listeners anteriores para evitar duplicados
    socket.off('ludoLobbyChatHistory');
    socket.off('ludoLobbyChatUpdate');
    socket.off('lobbyChatHistory');
    socket.off('lobbyChatUpdate');
    
    socket.on('ludoLobbyChatHistory', (history) => {
        console.log('Historial del chat del lobby de Ludo recibido.');
        renderLobbyChat(history);
    });

    socket.on('ludoLobbyChatUpdate', (newMessage) => {
        addLobbyChatMessage(newMessage);
    });
    
    socket.on('ludoLobbyChatCleared', () => {
        console.log('Chat del lobby de Ludo limpiado automáticamente después de 10 minutos de inactividad');
        renderLobbyChat([]); // Limpiar el chat visualmente
    });
    // ▲▲▲ FIN DE LOS LISTENERS DEL CHAT DE LUDO ▲▲▲

    socket.on('exchangeRatesUpdate', (rates) => {
        console.log('Tasas de cambio actualizadas:', rates);
        clientExchangeRates = rates;
        renderRoomsOverview(lastKnownRooms);
    });

    socket.on('roomCreatedSuccessfully', (roomData) => {
        showGameView({ ...roomData, isPractice: false });
    });
    
    socket.on('joinedRoomSuccessfully', (roomData) => {
        showGameView({ ...roomData, isPractice: false });
    });

    socket.on('joinError', (message) => {
        console.error('Error al unirse a la sala:', message);
        showToast(`Error: ${message}`, 4000);
    });

    // ▼▼▼ AÑADE ESTE LISTENER ▼▼▼
    socket.on('roomCreationFailed', (data) => {
        console.error('Error al crear la sala:', data.message);
        // Usamos showToast, que ya existe y es no-bloqueante
        showToast(`Error al crear la sala: ${data.message}`, 5000); 
    });
    // ▲▲▲ FIN DEL LISTENER AÑADIDO ▲▲▲

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
    
    // clearAllData(); // <-- LÍNEA COMENTADA
    
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
        // Asegurar que el modal esté oculto cuando se centra el lobby
        forceHideCreateRoomModal();
        
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
        creditModal.style.display = 'block';
    });
    btnCloseCreditModal.addEventListener('click', () => { creditModal.style.display = 'none'; });
    
    // ▼▼▼ LISTENERS PARA MODAL "OLVIDÉ MI CONTRASEÑA" ▼▼▼
    const btnForgotPassword = document.getElementById('btn-forgot-password');
    const forgotPasswordModal = document.getElementById('forgot-password-modal');
    const btnCloseForgotModal = document.getElementById('btn-close-forgot-modal');

    if (btnForgotPassword && forgotPasswordModal && btnCloseForgotModal) {
        btnForgotPassword.addEventListener('click', (e) => {
            e.preventDefault();
            forgotPasswordModal.style.display = 'block';
        });

        btnCloseForgotModal.addEventListener('click', () => {
            forgotPasswordModal.style.display = 'none';
        });
    }
    // ▲▲▲ FIN LISTENERS "OLVIDÉ MI CONTRASEÑA" ▲▲▲
    
    btnRules.addEventListener('click', () => { rulesModal.style.display = 'block'; });
    btnCloseRulesModal.addEventListener('click', () => { rulesModal.style.display = 'none'; });

    function createRoom() {
        // Remover el atributo forzado ANTES de mostrar el modal
        if (createRoomModal) {
            createRoomModal.removeAttribute('data-forced-hidden');
        }
        createRoomError.style.display = 'none';
        betInput.value = 10;
        
        // Inicializar correctamente los contenedores de opciones según el tipo de juego
        const gameTypeSelect = document.getElementById('game-type-select');
        const ludoOptions = document.getElementById('ludo-options-container');
        const parchisOptions = document.getElementById('parchis-options-container');
        
        if (gameTypeSelect && ludoOptions && parchisOptions) {
            const isParchis = gameTypeSelect.value === 'parchis';
            // Forzar el display usando estilo inline para que tenga prioridad sobre CSS
            ludoOptions.style.display = isParchis ? 'none' : 'block';
            parchisOptions.style.display = isParchis ? 'block' : 'none';
            // Asegurar que se respete usando setProperty con important flag
            ludoOptions.style.setProperty('display', isParchis ? 'none' : 'block', 'important');
            parchisOptions.style.setProperty('display', isParchis ? 'block' : 'none', 'important');
        }
        
        // Solo mostrar cuando se llame explícitamente
        if (createRoomModal) {
            createRoomModal.style.display = 'flex';
        }
    }
    
    // Función para forzar ocultar el modal - Disponible globalmente
    window.forceHideCreateRoomModal = function() {
        if (createRoomModal) {
            createRoomModal.style.display = 'none';
            createRoomModal.setAttribute('data-forced-hidden', 'true');
        }
    };
    
    // Función local también para compatibilidad
    function forceHideCreateRoomModal() {
        if (createRoomModal) {
            createRoomModal.style.display = 'none';
            createRoomModal.setAttribute('data-forced-hidden', 'true');
        }
    }
    
    // Asegurar que el modal esté oculto al cargar la página y cuando se muestra el lobby
    if (createRoomModal) {
        forceHideCreateRoomModal();
    }
    
    // Interceptar cualquier cambio de display del modal - Versión mejorada
    const modalElement = createRoomModal;
    if (modalElement) {
        // Observar cambios en el estilo display de forma más agresiva
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (modalElement.hasAttribute('data-forced-hidden')) {
                        // Si el modal tiene el atributo y se está mostrando, forzar ocultamiento inmediatamente
                        const computedDisplay = window.getComputedStyle(modalElement).display;
                        if (computedDisplay === 'flex' || computedDisplay === 'block' || modalElement.style.display === 'flex' || modalElement.style.display === 'block') {
                            forceHideCreateRoomModal();
                        }
                    }
                }
            });
        });
        
        observer.observe(modalElement, {
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: false
        });
        
        // Usar un enfoque simple y robusto: verificar periódicamente cuando el modal está forzado a estar oculto
        let checkInterval = null;
        
        const startCheckInterval = () => {
            if (checkInterval) return; // Ya está activo
            checkInterval = setInterval(() => {
                if (modalElement.hasAttribute('data-forced-hidden')) {
                    const computedDisplay = window.getComputedStyle(modalElement).display;
                    if (computedDisplay === 'flex' || computedDisplay === 'block' || modalElement.style.display === 'flex' || modalElement.style.display === 'block') {
                        forceHideCreateRoomModal();
                    }
                } else {
                    // Si ya no tiene el atributo, limpiar el intervalo
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
            }, 50);
        };
        
        const stopCheckInterval = () => {
            if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
            }
        };
        
        // Iniciar el intervalo si el modal tiene el atributo inicialmente
        if (modalElement.hasAttribute('data-forced-hidden')) {
            startCheckInterval();
        }
        
        // Observar cambios en el atributo para iniciar/detener el intervalo
        const cleanupObserver = new MutationObserver(() => {
            if (modalElement.hasAttribute('data-forced-hidden')) {
                startCheckInterval();
            } else {
                stopCheckInterval();
            }
        });
        cleanupObserver.observe(modalElement, {
            attributes: true,
            attributeFilter: ['data-forced-hidden']
        });
    }
    
    // Asegurar que el modal esté oculto cuando se muestra el lobby
    const originalShowLobby = showLobbyView;
    if (typeof originalShowLobby === 'function') {
        window.showLobbyView = function() {
            originalShowLobby();
            forceHideCreateRoomModal();
        };
    }
    
    // Interceptar cualquier intento de mostrar el modal automáticamente
    const originalCreateRoom = createRoom;
    window.createRoom = function() {
        if (createRoomModal) {
            createRoomModal.removeAttribute('data-forced-hidden');
        }
        originalCreateRoom();
    };

    function confirmCreateRoom() {
        const bet = parseInt(betInput.value);
        
        // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
        const currency = document.getElementById('create-room-currency').value;

        // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
        const chosenColor = document.getElementById('host-color-select').value;

        // ▼▼▼ AÑADIDO: Nuevos parámetros según el tipo de juego ▼▼▼
        const gameType = document.getElementById('game-type-select').value;
        let pieceCount = 4;
        let autoExit = 'double';
        let parchisMode = '2-individual';

        if (gameType === 'ludo') {
            pieceCount = parseInt(document.getElementById('piece-count-select').value, 10);
            autoExit = document.getElementById('auto-exit-select').value;
        } else {
            pieceCount = 4;
            autoExit = 'double';
            const parchisModeSelect = document.getElementById('parchis-mode-select');
            parchisMode = parchisModeSelect ? parchisModeSelect.value : '2-individual';
        }
        // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

        if (isNaN(bet) || bet <= 0) {
            createRoomError.textContent = 'La apuesta debe ser un número positivo.';
            createRoomError.style.display = 'block';
            return;
        }
        const totalCostInRoomCurrency = bet; // Solo la apuesta

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
            createRoomError.innerHTML = `Créditos insuficientes. <br>Para crear la mesa (${friendlyBet}) necesitas el equivalente a <strong>${requiredAmountInUserCurrency.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrency}</strong>.`;
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
            betCurrency: currency,
            chosenColor: chosenColor, // <-- AÑADE ESTA LÍNEA
            gameType: gameType,
            pieceCount: pieceCount, // <-- AÑADE ESTA LÍNEA
            autoExit: autoExit, // <-- AÑADE ESTA LÍNEA
            parchisMode: parchisMode
        };
        socket.emit('createLudoRoom', roomSettings);
        if (createRoomModal) {
            createRoomModal.style.display = 'none';
            // Al cerrar manualmente después de crear, remover el atributo
            createRoomModal.removeAttribute('data-forced-hidden');
        }
    }

    btnCreateRoomConfirm.addEventListener('click', confirmCreateRoom);
    btnCreateRoomCancel.addEventListener('click', () => { 
        if (createRoomModal) {
            createRoomModal.style.display = 'none';
            // Al cerrar manualmente, remover el atributo para que pueda abrirse de nuevo
            createRoomModal.removeAttribute('data-forced-hidden');
        }
    });
    
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
        socket.disconnect(); 
        
        currentUser = {
            username: '',
            userAvatar: '',
            userId: '',
            credits: 1000
        };
        
        const portalSession = localStorage.getItem(PORTAL_SESSION_KEY);
        if (portalSession) {
            try {
                const parsed = JSON.parse(portalSession);
                if (parsed?.sessionToken) {
                    fetch('/logout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: parsed.sessionToken })
                    }).catch(() => {});
                }
            } catch (error) {
                console.warn('No se pudo limpiar la sesión del portal', error);
            }
            localStorage.removeItem(PORTAL_SESSION_KEY);
        }
        sessionStorage.removeItem('userId');
        sessionStorage.removeItem('username');
        sessionStorage.removeItem('userAvatar');
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
        isJoiningLudoRoom = true; // <-- AÑADE ESTA LÍNEA
        socket.emit('joinLudoRoom', { roomId, user });
    }

// REEMPLAZA LA FUNCIÓN renderRoomsOverview ENTERA CON ESTO:
// REEMPLAZA LA FUNCIÓN renderRoomsOverview ENTERA CON ESTA VERSIÓN MEJORADA
function renderRoomsOverview(rooms = []) {
    if (!roomsOverviewEl) return;
    roomsOverviewEl.innerHTML = ''; // Limpiar la vista

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
    createTableItem.querySelector('button').onclick = function() {
        if (createRoomModal) {
            createRoomModal.removeAttribute('data-forced-hidden');
        }
        createRoom();
    };
    roomsOverviewEl.appendChild(createTableItem);

    if (!Array.isArray(rooms)) {
        console.error("Error: el dato 'rooms' recibido no es un array.", rooms);
        return;
    }

    // --- INICIO DE LAS MODIFICACIONES ---

    // 1. CREAMOS UNA FUNCIÓN AUXILIAR REUTILIZABLE PARA LAS CONVERSIONES
    // Esto nos permitirá usarla para la apuesta.
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
        try {
            const div = document.createElement('div');
            div.className = 'table-item';

            const seated = (roomData.seats || []).filter(Boolean).length;
            const bet = parseInt(roomData.settings?.bet || 0);
            const hostUsername = roomData.settings?.username || 'Desconocido';
            const isEffectivelyPlaying = roomData.state === 'playing' || roomData.state === 'post-game';
            const betCurrency = roomData.settings?.betCurrency || 'USD';

            // --- INICIO DE LA MODIFICACIÓN 2 ---
            // 2. USAMOS LA FUNCIÓN AUXILIAR PARA APUESTA
            const convertedBetHTML = getConvertedValueHTML(bet, betCurrency);
            // --- FIN DE LA MODIFICACIÓN 2 ---

            // *** REFUERZO 1: Obtener gameType y parchisMode ***
            const gameType = roomData.settings?.gameType || 'ludo';
            const parchisMode = roomData.settings?.parchisMode || '4-individual';
            
            // *** REFUERZO 2: Definir maxPlayers PRIMERO ***
            let maxPlayers = 4;
            if (gameType === 'parchis' && parchisMode === '2-individual') {
                maxPlayers = 2;
            }
            
            // Ahora usamos maxPlayers para calcular stateText
            let stateText;
            if (gameType === 'parchis' && parchisMode === '2-individual') {
                // Para 1 vs 1, mostramos texto especial
                stateText = isEffectivelyPlaying ? `Jugando (1 vs 1)` : `En espera (${seated} / 2)`;
            } else {
                // Para otros modos, usamos maxPlayers
                stateText = isEffectivelyPlaying ? `Jugando (${seated} / ${maxPlayers})` : `En espera (${seated} / ${maxPlayers})`;
            }

            const seatedPlayerNames = (roomData.seats || []).map(seat => seat ? seat.playerName : null).filter(Boolean);

            // ▼▼▼ NUEVO BLOQUE: Información según tipo de juego ▼▼▼

            let gameTypeHTML = '';
            if (gameType === 'parchis') {
                let modeText = 'Parchís ';
                if (parchisMode === '2-individual') modeText += '(1 vs 1)';
                else if (parchisMode === '4-individual') modeText += '(Individual)';
                else if (parchisMode === '4-groups') modeText += '(Grupos)';
                gameTypeHTML = `<div><strong>Juego:</strong> ${modeText}</div>`;
            } else {
                const pieceCount = roomData.settings?.pieceCount || 4;
                const autoExitSetting = roomData.settings?.autoExit || 'double';
                const autoExitText = autoExitSetting === 'auto' ? 'Salida Automática' : 'Salida con Doble';
                gameTypeHTML = `
                    <div><strong>Juego:</strong> Ludo</div>
                    <div><strong>Fichas:</strong> ${pieceCount}</div>
                    <div><strong>Salida:</strong> ${autoExitText}</div>
                `;
            }
            // ▲▲▲ FIN DEL BLOQUE NUEVO ▲▲▲

            // Se actualiza el innerHTML para mostrar la apuesta
            div.innerHTML = `
                <div class="info">
                    <div><strong>Mesa de:</strong> ${hostUsername}</div>
                    <div><strong>Estado:</strong> ${stateText}</div>
                    <div><strong>Apuesta:</strong> ${bet.toLocaleString('es-ES')} ${betCurrency}${convertedBetHTML}</div>
                    ${gameTypeHTML}
                    <div class="player-list"><strong>Jugadores:</strong> ${seatedPlayerNames.length > 0 ? seatedPlayerNames.join(', ') : '-'}</div>
                </div>
                <div class="actions"></div>
            `;

            const actionsContainer = div.querySelector('.actions');
            const btnEnter = document.createElement('button');
            btnEnter.textContent = 'Entrar';
            btnEnter.className = 'play-button';

            const requirementInRoomCurrency = bet;

            // Calculamos el coste en la moneda del jugador
            let requiredAmountInPlayerCurrency = requirementInRoomCurrency;
            if (currentUser.currency && betCurrency !== currentUser.currency) {
                 if (clientExchangeRates[currentUser.currency] && clientExchangeRates[currentUser.currency][betCurrency]) {
                    requiredAmountInPlayerCurrency = requirementInRoomCurrency / clientExchangeRates[currentUser.currency][betCurrency];
                }
            }
            
            const hasEnoughCredits = (currentUser.credits ?? 0) >= requiredAmountInPlayerCurrency;

            // *** REFUERZO 3: Usar maxPlayers (CORREGIDO) ***
            const isFull = (seated >= maxPlayers);
            const isPostGame = roomData.state === 'post-game';
            const isPlaying = roomData.state === 'playing';

            // --- INICIO: Lógica de Botón Unificada (Refuerzo 3 - Regla Estricta) ---
            // REGLA CRÍTICA: Parchís NUNCA muestra "Ver / Esperar", solo Ludo
            if (gameType === 'parchis') {
                // TODOS LOS CASOS DE PARCHÍS
                if (isFull) {
                    btnEnter.disabled = true;
                    btnEnter.textContent = 'Entrar';
                    if (parchisMode === '2-individual') {
                        btnEnter.title = 'Mesa 1 vs 1 llena.';
                    } else {
                        btnEnter.title = 'Mesa de Parchís llena.';
                    }
                } else if (isPostGame) {
                    btnEnter.disabled = false;
                    btnEnter.textContent = 'Unirse Revancha';
                    btnEnter.title = 'Partida terminada. ¡Únete a la revancha!';
                } else {
                    // Parchís: No lleno + Esperando o Jugando -> "Entrar" (NUNCA "Ver / Esperar")
                    btnEnter.disabled = false;
                    btnEnter.textContent = 'Entrar';
                    btnEnter.title = 'Entrar a la mesa.';
                }
            } else {
                // TODOS LOS CASOS DE LUDO
                if (isFull) {
                    btnEnter.disabled = true;
                    if (isPostGame) {
                        btnEnter.textContent = 'Unirse Revancha';
                        btnEnter.title = 'Mesa llena. Esperando inicio de revancha.';
                    } else if (isPlaying) {
                        btnEnter.textContent = 'Ver / Esperar'; // <--- SOLO LUDO
                        btnEnter.title = 'Mesa llena (Partida en curso).';
                    } else {
                        btnEnter.textContent = 'Entrar';
                        btnEnter.title = 'Mesa llena.';
                    }
                } else {
                    btnEnter.disabled = false;
                    if (isPostGame) {
                        btnEnter.textContent = 'Unirse Revancha';
                        btnEnter.title = 'Partida terminada. ¡Únete a la revancha!';
                    } else if (isPlaying) {
                        btnEnter.textContent = 'Ver / Esperar'; // <--- SOLO LUDO
                        btnEnter.title = 'Entrar como espectador / Esperar siguiente partida.';
                    } else {
                        btnEnter.textContent = 'Entrar';
                        btnEnter.title = 'Entrar a la mesa.';
                    }
                }
            }
            // --- FIN: Lógica de Botón Unificada ---

            // 2. Lógica ONCLICK (Siempre valida créditos y llama a handleJoinRoom)
            // *** LA LÓGICA ONCLICK (VALIDACIÓN CRÉDITOS + handleJoinRoom) ***
            btnEnter.onclick = () => {
                // ▼▼▼ LOG 1: Inicio del clic ▼▼▼
                console.log(`[Lobby JOIN CLICK] Clic en ${roomData.roomId}. Estado sala: ${roomData.state}`);
                // ▲▲▲ FIN LOG 1 ▲▲▲

                const userCreditsNow = currentUser.credits ?? 0;
                const userCurrencyNow = currentUser.currency || 'USD';
                const bet = parseInt(roomData.settings?.bet || 0);
                const betCurrency = roomData.settings?.betCurrency || 'USD';
                const requirementInRoomCurrency = bet;
                let requiredInUserCurrency = requirementInRoomCurrency;

                // ▼▼▼ LOG 2: Antes de conversión ▼▼▼
                console.log(`  - User: ${userCreditsNow.toFixed(2)} ${userCurrencyNow}`);
                console.log(`  - Requirement (Room): ${requirementInRoomCurrency.toFixed(2)} ${betCurrency}`);
                // ▲▲▲ FIN LOG 2 ▲▲▲

                if (userCurrencyNow !== betCurrency && clientExchangeRates) {
                    // (Lógica de conversión de moneda...)
                    if (clientExchangeRates[betCurrency] && clientExchangeRates[betCurrency][userCurrencyNow]) {
                        requiredInUserCurrency = requirementInRoomCurrency * clientExchangeRates[betCurrency][userCurrencyNow];
                    } else if (clientExchangeRates[userCurrencyNow] && clientExchangeRates[userCurrencyNow][betCurrency]) {
                        requiredInUserCurrency = requirementInRoomCurrency / clientExchangeRates[userCurrencyNow][betCurrency];
                    }
                }

                // ▼▼▼ LOG 3: Después de conversión y ANTES de validación ▼▼▼
                console.log(`  - Requirement (User): ${requiredInUserCurrency.toFixed(2)} ${userCurrencyNow}`);
                const hasEnough = userCreditsNow >= requiredInUserCurrency;
                console.log(`  - Tiene créditos suficientes?: ${hasEnough}`);
                // ▲▲▲ FIN LOG 3 ▲▲▲

                console.log(`VALIDANDO UNIÓN: Créditos=${userCreditsNow} ${userCurrencyNow} vs Requerido=${requiredInUserCurrency.toFixed(2)} ${userCurrencyNow}`); // Log existente

                if (hasEnough) {
                    // ▼▼▼ LOG 4: Antes de llamar a handleJoinRoom ▼▼▼
                    console.log(`  -> Llamando a handleJoinRoom con ID: ${roomData.roomId}`);
                    // ▲▲▲ FIN LOG 4 ▲▲▲
                    handleJoinRoom(roomData.roomId);
                } else {
                    // ▼▼▼ LOG 5: Si fallan los créditos ▼▼▼
                    console.log(`  -> Falló validación de créditos. Mostrando modal.`);
                    // ▲▲▲ FIN LOG 5 ▲▲▲
                    const missingAmount = requiredInUserCurrency - userCreditsNow;
                    const friendlyRequired = `${requiredInUserCurrency.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrencyNow}`;
                    const friendlyMissing = `${missingAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${userCurrencyNow}`;
                    showInsufficientFundsModal(friendlyRequired, friendlyMissing);
                }
            }; // Fin del onclick

            actionsContainer.appendChild(btnEnter); // Añadir el botón al DOM
            
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
        // Verificar si el mensaje ya existe para evitar duplicados
        if (msg.id) {
            const existingMsg = chatEl.querySelector(`[data-msg-id="${msg.id}"]`);
            if (existingMsg) {
                console.log('Mensaje duplicado detectado, ignorando:', msg.id);
                return; // Ya existe, no lo añadimos de nuevo
            }
        }

        const m = document.createElement('div');
        m.style.marginBottom = '6px';
        if (msg.id) {
            m.setAttribute('data-msg-id', msg.id); // Marcar con ID para evitar duplicados
        }

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
            welcomeDiv.textContent = '¡Bienvenido al lobby de LUDO Y PARCHÍS! Sé respetuoso y disfruta del juego.';
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
    // No necesitamos renderizar el chat aquí, ya se renderiza automáticamente cuando se recibe el historial
}

    function showLoginModal() {
        loginError.style.display = 'none';
        loginUsernameInput.value = ''; loginPasswordInput.value = '';
        loginModal.style.display = 'block';
    }
    
    function showRegisterModal() {
        registerError.style.display = 'none'; registerSuccess.style.display = 'none';
        registerNameInput.value = ''; registerCountrySelect.value = ''; registerWhatsAppInput.value = '';
        registerPasswordInput.value = ''; registerConfirmPasswordInput.value = '';
        selectedAvatar = null; avatarPreviewContainer.style.display = 'none';
        populateAvatarGallery();
        loginModal.style.display = 'none'; registerModal.style.display = 'block';
    }

    const PORTAL_SESSION_KEY = 'portalAuth';

    function completeLogin(user) {
        if (!socket.connected) {
            socket.connect();
        }
        socket.emit('userLoggedIn', { username: user.name, currency: user.currency });

        currentUser = {
            username: user.name,
            userAvatar: user.avatar,
            userId: 'user_' + user.name.toLowerCase(),
            credits: parseFloat(user.credits ?? 0),
            currency: user.currency
        };

        document.getElementById('user-name').textContent = user.name;
        if (user.avatar) {
            userAvatarEl.src = user.avatar;
        }
        loginModal.style.display = 'none';
        body.classList.add('is-logged-in');
        
        // Asegurar que el modal de creación de mesa esté oculto ANTES de mostrar el lobby
        forceHideCreateRoomModal();
        
        lobbyOverlay.style.display = 'flex';
        
        // Asegurar que el modal de creación de mesa esté oculto DESPUÉS de mostrar el lobby
        setTimeout(() => {
            forceHideCreateRoomModal();
        }, 0);
        setTimeout(() => {
            forceHideCreateRoomModal();
        }, 100);

        showPwaInstallModal();
        setTimeout(() => {
            scaleAndCenterLobby();
            forceHideCreateRoomModal();
        }, 0);
        window.addEventListener('resize', scaleAndCenterLobby);

        // ▼▼▼ CRÍTICO: Guardar en sessionStorage Y localStorage para persistencia en PWA ▼▼▼
        const userId = currentUser.userId;
        sessionStorage.setItem('userId', userId);
        localStorage.setItem('userId', userId); // Respaldo para PWA
        sessionStorage.setItem('username', user.name);
        localStorage.setItem('username', user.name); // Respaldo para PWA
        sessionStorage.setItem('userAvatar', user.avatar || '');
        localStorage.setItem('userAvatar', user.avatar || ''); // Respaldo para PWA
        sessionStorage.setItem('userCurrency', user.currency || 'USD');
        localStorage.setItem('userCurrency', user.currency || 'USD'); // Respaldo para PWA
        console.log('[completeLogin] userId guardado en sessionStorage y localStorage:', userId);
        // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    }


    // REEMPLAZA LA FUNCIÓN doLogin() en ludolobby.js
    function doLogin() {
        const username = sessionStorage.getItem('username');
        const userAvatar = sessionStorage.getItem('userAvatar');
        const userCurrency = sessionStorage.getItem('userCurrency');

        if (!username) {
            alert('Error de sesión. Volviendo al login principal.');
            window.location.href = '/';
            return;
        }

        socket.connect(); 
        socket.emit('userLoggedIn', { username: username, currency: userCurrency });

        currentUser = {
            username: username,
            userAvatar: userAvatar,
            userId: 'user_' + username.toLowerCase(),
        };

        localStorage.setItem('username', username);
        localStorage.setItem('userAvatar', userAvatar);

        loginModal.style.display = 'none';
        document.getElementById('user-name').textContent = username;
        userAvatarEl.src = userAvatar;

        body.classList.add('is-logged-in');
        
        // Asegurar que el modal de creación de mesa esté oculto ANTES de mostrar el lobby
        forceHideCreateRoomModal();
        
        lobbyOverlay.style.display = 'flex';
        
        // Asegurar que el modal de creación de mesa esté oculto DESPUÉS de mostrar el lobby
        setTimeout(() => {
            forceHideCreateRoomModal();
        }, 0);
        setTimeout(() => {
            forceHideCreateRoomModal();
        }, 100);

        showPwaInstallModal(); 
        setTimeout(() => {
            scaleAndCenterLobby();
            forceHideCreateRoomModal();
        }, 0);
        window.addEventListener('resize', () => {
            scaleAndCenterLobby();
            forceHideCreateRoomModal();
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
            avatarCropModal.style.display = 'block';
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
    window.addEventListener('mousemove', (e) => { if (!cropperState.isDragging || avatarCropModal.style.display !== 'block') return; e.preventDefault(); cropperState.wrapperX = e.clientX - cropperState.startX; cropperState.wrapperY = e.clientY - cropperState.startY; cropImageWrapper.style.left = `${cropperState.wrapperX}px`; cropImageWrapper.style.top = `${cropperState.wrapperY}px`; });
    window.addEventListener('mouseup', (e) => { if (!cropperState.isDragging) return; cropperState.isDragging = false; });
    cropContainer.addEventListener('touchstart', (e) => { const touch = e.touches[0]; cropperState.isDragging = true; cropperState.startX = touch.clientX - cropperState.wrapperX; cropperState.startY = touch.clientY - cropperState.wrapperY; }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (!cropperState.isDragging || avatarCropModal.style.display !== 'block') return; e.preventDefault(); const touch = e.touches[0]; cropperState.wrapperX = touch.clientX - cropperState.startX; cropperState.wrapperY = touch.clientY - cropperState.startY; cropImageWrapper.style.left = `${cropperState.wrapperX}px`; cropImageWrapper.style.top = `${cropperState.wrapperY}px`; }, { passive: false });
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
    
    async function attemptPortalAutoLogin() {
        const raw = localStorage.getItem(PORTAL_SESSION_KEY);
        if (!raw) {
            showLoginModal();
            return;
        }
        try {
            const sessionData = JSON.parse(raw);
            if (!sessionData?.sessionToken) {
                throw new Error('Sesión inválida');
            }
            const response = await fetch('/session-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: sessionData.sessionToken })
            });
            if (!response.ok) {
                throw new Error('Sesión expirada');
            }
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || 'Sesión inválida');
            }
            localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify({
                sessionToken: result.sessionToken,
                user: result.user,
                savedAt: Date.now()
            }));
            completeLogin(result.user);
        } catch (error) {
            console.warn('Auto login del portal falló', error);
            localStorage.removeItem(PORTAL_SESSION_KEY);
            showLoginModal();
        }
    }

    (function init() {
        console.log('--- INICIANDO VERSIÓN CON LOGIN UNIFICADO ---');
        initCountries();
 
        // ▼▼▼ AÑADIDO: Manejo dinámico de opciones según tipo de juego ▼▼▼
        const gameTypeSelect = document.getElementById('game-type-select');
        const ludoOptions = document.getElementById('ludo-options-container');
        const parchisOptions = document.getElementById('parchis-options-container');
        const parchisModeSelect = document.getElementById('parchis-mode-select');
        const hostColorSelect = document.getElementById('host-color-select');

        // Función para actualizar los textos del selector de color
        const updateColorSelectTexts = () => {
            if (!hostColorSelect) return;
            const isParchis = gameTypeSelect?.value === 'parchis';
            const isGroups = isParchis && parchisModeSelect?.value === '4-groups';
            
            // Guardar la selección actual para intentar mantenerla
            const currentVal = hostColorSelect.value;

            // Definir las opciones base
            const options = [
                { val: 'yellow', text: 'Amarillo' },
                { val: 'green', text: 'Verde' },
                { val: 'red', text: 'Rojo' },
                { val: 'blue', text: 'Azul' }
            ];

            // Limpiar el select
            hostColorSelect.innerHTML = '';

            options.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.val;
                
                if (isGroups) {
                    // Si es grupos, mostramos la pareja correspondiente
                    if (opt.val === 'yellow') el.textContent = 'Amarillo (Tu pareja: Rojo)';
                    else if (opt.val === 'red') el.textContent = 'Rojo (Tu pareja: Amarillo)';
                    else if (opt.val === 'green') el.textContent = 'Verde (Tu pareja: Azul)';
                    else if (opt.val === 'blue') el.textContent = 'Azul (Tu pareja: Verde)';
                } else {
                    // Texto normal
                    el.textContent = opt.text;
                }
                hostColorSelect.appendChild(el);
            });

            // Restaurar selección
            hostColorSelect.value = currentVal;
        };

        if (gameTypeSelect && ludoOptions && parchisOptions) {
            // Evento cambio de juego (Ludo/Parchis)
            gameTypeSelect.addEventListener('change', () => {
                const isParchis = gameTypeSelect.value === 'parchis';
                // Forzar el display usando setProperty con important flag para que tenga prioridad sobre CSS
                ludoOptions.style.setProperty('display', isParchis ? 'none' : 'block', 'important');
                parchisOptions.style.setProperty('display', isParchis ? 'block' : 'none', 'important');
                updateColorSelectTexts(); // Actualizar textos
            });

            // Evento cambio de modo Parchís (Individual/Grupos)
            if (parchisModeSelect) {
                parchisModeSelect.addEventListener('change', updateColorSelectTexts);
            }

            // Inicializar textos al cargar
            updateColorSelectTexts();
        }
        // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲
 
        // ▼▼▼ REEMPLAZA EL BLOQUE DE REANUDACIÓN DE SESIÓN CON ESTO ▼▼▼
        console.log('Iniciando sesión automática desde sessionStorage...');
        body.classList.remove('is-logged-in');
        lobbyOverlay.style.display = 'none';
        doLogin(); // Inicia sesión automáticamente
        // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
         
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
                 changePasswordModal.style.display = 'block';
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



// Variable global para controlar el estado del sonido
let isMuted = false;

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

    // ▼▼▼ BLOQUE REEMPLAZADO: Lógica de cierre de modal mejorada ▼▼▼
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => {
            const modal = btn.closest('.overlay, [role="dialog"]');
            if (modal) {
                // --- CASO ESPECIAL: Modal de Registro ---
                // Si cerramos el modal de registro, queremos volver al de login,
                // no quedarnos en una pantalla en blanco.
                if (modal.id === 'register-modal') {
                    modal.style.display = 'none';
                    // Nos aseguramos que la función showLoginModal exista antes de llamarla
                    if (typeof showLoginModal === 'function') {
                        showLoginModal();
                    }
                } else {
                    // Comportamiento por defecto para todos los demás modales
                    modal.style.display = 'none';
                    // Si es el modal de creación de mesa, remover el atributo para que pueda abrirse de nuevo
                    if (modal.id === 'create-room-modal') {
                        if (typeof forceHideCreateRoomModal === 'function') {
                            forceHideCreateRoomModal();
                        } else if (typeof window.forceHideCreateRoomModal === 'function') {
                            window.forceHideCreateRoomModal();
                        }
                        // Al cerrar con la X, remover el atributo para que pueda abrirse de nuevo
                        modal.removeAttribute('data-forced-hidden');
                    }
                }
            }
        };
    });
    
    // ▼▼▼ FIX CRÍTICO: Prevenir cierre del modal en móviles/PWA - Solución agresiva con bandera global ▼▼▼
    const createRoomModal = document.getElementById('create-room-modal');
    if (createRoomModal) {
        // Bandera global para prevenir cierre durante interacción
        let isInteractingWithInput = false;
        let preventCloseTimeout = null;
        
        const modalContent = createRoomModal.querySelector('.modal-content');
        const betInput = document.getElementById('bet-input');
        
        // Función para forzar que el modal permanezca abierto
        const forceModalOpen = () => {
            if (createRoomModal) {
                createRoomModal.style.display = 'flex';
                createRoomModal.style.setProperty('display', 'flex', 'important');
                createRoomModal.removeAttribute('data-forced-hidden');
            }
        };
        
        // Interceptar TODOS los intentos de cerrar el modal
        const originalForceHide = window.forceHideCreateRoomModal;
        window.forceHideCreateRoomModal = function() {
            // Solo bloquear si estamos interactuando con inputs Y no se permite el cierre
            if (isInteractingWithInput && !allowClose) {
                console.log('[Modal Protection] Bloqueado cierre del modal durante interacción con input');
                forceModalOpen();
                return;
            }
            // Si se permite el cierre, resetear la bandera
            if (allowClose) {
                allowClose = false;
            }
            if (originalForceHide) {
                originalForceHide();
            }
        };
        
        // Bandera para permitir cierre intencional por botones
        let allowClose = false;
        
        // Interceptar cambios directos en el display del modal
        const modalObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const display = createRoomModal.style.display;
                    // Solo bloquear el cierre si estamos interactuando con inputs Y no se permite el cierre
                    if (isInteractingWithInput && !allowClose && (display === 'none' || !display || display === '')) {
                        console.log('[Modal Protection] Detectado intento de cierre, forzando apertura');
                        forceModalOpen();
                    } else if (allowClose) {
                        // Si se permite el cierre, resetear la bandera
                        allowClose = false;
                    }
                }
            });
        });
        modalObserver.observe(createRoomModal, { attributes: true, attributeFilter: ['style'] });
        
        if (modalContent) {
            // NO bloquear eventos en botones - solo en inputs/selects
            // Los botones deben funcionar normalmente
            
            // Protección específica para el input de apuesta
            if (betInput) {
                const setInteractionFlag = (value) => {
                    isInteractingWithInput = value;
                    if (value) {
                        forceModalOpen();
                        // Limpiar timeout anterior si existe
                        if (preventCloseTimeout) {
                            clearTimeout(preventCloseTimeout);
                        }
                        // Mantener la bandera activa por 2 segundos después de la última interacción
                        preventCloseTimeout = setTimeout(() => {
                            isInteractingWithInput = false;
                        }, 2000);
                    }
                };
                
                ['focus', 'click', 'touchstart', 'touchend', 'input', 'keydown', 'keyup'].forEach(eventType => {
                    betInput.addEventListener(eventType, (e) => {
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        setInteractionFlag(true);
                        forceModalOpen();
                        return false;
                    }, { passive: false, capture: true });
                });
                
                betInput.addEventListener('blur', (e) => {
                    e.stopPropagation();
                    // Mantener la bandera activa un poco más después del blur
                    setTimeout(() => {
                        isInteractingWithInput = false;
                    }, 500);
                }, { passive: true });
            }
            
            // Prevenir propagación SOLO en inputs y selects (NO en botones)
            const allInputs = modalContent.querySelectorAll('input:not([type="button"]):not([type="submit"]), select, textarea');
            allInputs.forEach(input => {
                ['click', 'touchstart', 'touchend', 'focus'].forEach(eventType => {
                    input.addEventListener(eventType, (e) => {
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        if (input === betInput || input.tagName === 'INPUT') {
                            isInteractingWithInput = true;
                            if (preventCloseTimeout) {
                                clearTimeout(preventCloseTimeout);
                            }
                            preventCloseTimeout = setTimeout(() => {
                                isInteractingWithInput = false;
                            }, 2000);
                        }
                        forceModalOpen();
                        return false;
                    }, { passive: false, capture: true });
                });
            });
            
            // Permitir que los botones funcionen normalmente - NO bloquear sus eventos
            const buttons = modalContent.querySelectorAll('button');
            buttons.forEach(button => {
                // Asegurar que los botones puedan cerrar el modal
                button.addEventListener('click', (e) => {
                    // Desactivar la bandera de protección cuando se hace clic en un botón
                    isInteractingWithInput = false;
                    allowClose = true; // Permitir que el modal se cierre
                    if (preventCloseTimeout) {
                        clearTimeout(preventCloseTimeout);
                    }
                    // NO bloquear la propagación - permitir que el evento continúe normalmente
                }, { passive: true });
                
                // También para eventos touch
                button.addEventListener('touchstart', (e) => {
                    isInteractingWithInput = false;
                    allowClose = true;
                    if (preventCloseTimeout) {
                        clearTimeout(preventCloseTimeout);
                    }
                }, { passive: true });
            });
        }
        
        // Solo cerrar cuando se hace clic DIRECTAMENTE en el overlay (fuera del modal-content)
        // NO usar capture: true aquí para permitir que los botones funcionen
        createRoomModal.addEventListener('click', (e) => {
            // Si el clic fue en un botón, permitir que funcione normalmente
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                // Los botones pueden cerrar el modal normalmente
                isInteractingWithInput = false;
                if (preventCloseTimeout) {
                    clearTimeout(preventCloseTimeout);
                }
                return; // Permitir que el evento continúe normalmente
            }
            
            // Verificar que el clic fue EXACTAMENTE en el overlay, no en ningún hijo
            if (e.target === createRoomModal && !modalContent.contains(e.target) && !isInteractingWithInput) {
                createRoomModal.style.display = 'none';
                if (typeof originalForceHide === 'function') {
                    originalForceHide();
                }
                createRoomModal.setAttribute('data-forced-hidden', 'true');
            } else if (isInteractingWithInput && e.target !== createRoomModal) {
                // Solo prevenir cierre si NO es un botón y estamos interactuando con un input
                e.stopPropagation();
                forceModalOpen();
            }
        });
        
        // Prevenir cierre en eventos touch en el overlay
        createRoomModal.addEventListener('touchstart', (e) => {
            // Si el touch fue en un botón, permitir que funcione normalmente
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                isInteractingWithInput = false;
                if (preventCloseTimeout) {
                    clearTimeout(preventCloseTimeout);
                }
                return; // Permitir que el evento continúe normalmente
            }
            
            if (e.target === createRoomModal && !modalContent.contains(e.target) && !isInteractingWithInput) {
                // Solo permitir cerrar si no hay interacción activa
                setTimeout(() => {
                    if (e.target === createRoomModal && !isInteractingWithInput) {
                        createRoomModal.style.display = 'none';
                        if (typeof originalForceHide === 'function') {
                            originalForceHide();
                        }
                        createRoomModal.setAttribute('data-forced-hidden', 'true');
                    }
                }, 200);
            } else if (isInteractingWithInput && e.target !== createRoomModal) {
                // Solo prevenir cierre si NO es un botón y estamos interactuando con un input
                e.stopPropagation();
                forceModalOpen();
            }
        }, { passive: false });
    }
    // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲
});

// ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

// ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AL FINAL DE game.js ▼▼▼

/**
 * Configura el registro del Service Worker y el sistema de notificación de actualizaciones.
 */
// ▼▼▼ COMENTADO: PWA UPDATE NOTIFICATIONS ▼▼▼
/*
function setupPwaUpdateNotifications() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(registration => {
            console.log('SW registrado exitosamente:', registration.scope);

            // 1. Escuchamos si se encuentra una nueva versión del SW
            registration.addEventListener('updatefound', () => {
                console.log('Nueva versión del Service Worker encontrada.');
                const newWorker = registration.installing;

                // 2. Esperamos a que el nuevo SW termine de instalarse
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // 3. El nuevo SW está instalado y "en espera". ¡Es hora de notificar al usuario!
                        const notification = document.getElementById('update-notification');
                        const reloadButton = document.getElementById('btn-reload-update');

                        if (notification && reloadButton) {
                            notification.style.display = 'flex'; // Mostramos el aviso

                            // 4. Le decimos al nuevo SW que se active cuando el usuario haga clic
                            reloadButton.addEventListener('click', () => {
                                newWorker.postMessage({ type: 'SKIP_WAITING' });
                            });
                        }
                    }
                });
            });
        }).catch(error => {
            console.log('Error al registrar SW:', error);
        });

        // 5. Recargamos la página una vez que el nuevo SW toma el control
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('Nuevo Service Worker activado. Recargando página...');
            window.location.reload();
        });
    }
}

// Ejecutamos la configuración cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', setupPwaUpdateNotifications);
*/
// ▲▲▲ FIN DEL BLOQUE COMENTADO ▲▲▲

// ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲// Cache bust: Tue Oct  7 11:46:02 WEST 2025
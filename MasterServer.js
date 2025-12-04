// server.js (Archivo completo y actualizado) - v1.0

const express = require('express');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { initLudoEngine } = require('./server/ludoEngine');

const app = express();
app.use(express.json({ limit: '10mb' })); // Aumentar límite para avatares
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Para formularios también

// Middleware de logging para debug
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
  }
});

const PORT = process.env.PORT || 3000;

// Bandera para desactivar la base de datos (usar variable de entorno o false por defecto)
// En producción (Render), establecer DISABLE_DB=false o no definirla para usar PostgreSQL
const DISABLE_DB = process.env.DISABLE_DB === 'true' || process.env.DISABLE_DB === '1';

// Almacén de usuarios en memoria cuando la DB está desactivada
const inMemoryUsers = new Map();
if (DISABLE_DB) {
  const seedUsers = ['a', 'b', 'c', 'd'];
  seedUsers.forEach((username, index) => {
    if (!inMemoryUsers.has(username)) {
      inMemoryUsers.set(username, {
        username,
        password_hash: username, // Contraseña sencilla solicitada
        credits: 1000,
        currency: 'EUR',
        avatar_url: `https://i.pravatar.cc/150?img=${(index + 1) * 10}`
      });
    }
  });
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const activeSessions = new Map();

function createSessionToken(username) {
  const token = crypto.randomBytes(24).toString('hex');
  activeSessions.set(token, {
    username: username.toLowerCase(),
    createdAt: Date.now()
  });
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const entry = activeSessions.get(token);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    activeSessions.delete(token);
    return null;
  }
  return entry.username;
}

function invalidateSession(token) {
  if (token && activeSessions.has(token)) {
    activeSessions.delete(token);
  }
}

// Configuración de la base de datos PostgreSQL (solo si está habilitada)
let pool = null;
if (!DISABLE_DB) {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ADVERTENCIA: DATABASE_URL no está definida. El servidor puede fallar en rutas que requieren base de datos.');
  } else {
    try {
      // Configuración para Render PostgreSQL (requiere SSL)
      const poolConfig = {
        connectionString: process.env.DATABASE_URL
      };
      
      // Si la URL contiene 'render.com', habilitar SSL (requerido por Render)
      if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')) {
        poolConfig.ssl = {
          rejectUnauthorized: false
        };
      }
      
      pool = new Pool(poolConfig);

      // Probar la conexión a la base de datos
      pool.query('SELECT NOW()', (err, res) => {
        if (err) {
          console.error('❌ Error conectando a la base de datos:', err.stack);
        } else {
          console.log('✅ Conexión exitosa a la base de datos:', res.rows[0]);
          // Inicializar tablas después de conectar
          initializeDatabase();
        }
      });
    } catch (error) {
      console.error('❌ Error creando el pool de conexiones:', error);
      pool = null;
    }
  }
}

// Función para inicializar las tablas de la base de datos
async function initializeDatabase() {
  if (!pool) {
    console.error('❌ Error: No se puede inicializar la base de datos. Pool no disponible.');
    return;
  }
  
  try {
    // Tabla de usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        credits DECIMAL(10,2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'USD',
        avatar_url TEXT,
        country VARCHAR(10),
        whatsapp VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Añadir columnas de consentimiento si no existen (para tablas ya creadas)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='users' AND column_name='accepted_terms_at') THEN
          ALTER TABLE users ADD COLUMN accepted_terms_at TIMESTAMP WITHOUT TIME ZONE NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='users' AND column_name='accepted_privacy_at') THEN
          ALTER TABLE users ADD COLUMN accepted_privacy_at TIMESTAMP WITHOUT TIME ZONE NULL;
        END IF;
      END $$;
    `);

    // Tabla de salas/mesas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(255) UNIQUE NOT NULL,
        host_id VARCHAR(255) NOT NULL,
        state VARCHAR(50) DEFAULT 'waiting',
        settings JSONB DEFAULT '{}',
        pot DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de comisiones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commission_log (
        id SERIAL PRIMARY KEY,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'COP',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de historial de chat del lobby
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lobby_chat (
        id SERIAL PRIMARY KEY,
        message_id VARCHAR(255) UNIQUE NOT NULL,
        sender VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de tasas de cambio
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id SERIAL PRIMARY KEY,
        eur_cop DECIMAL(10,4) DEFAULT 4500,
        usd_cop DECIMAL(10,4) DEFAULT 4500,
        eur_usd DECIMAL(10,4) DEFAULT 1.05,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Inicializar tasas de cambio si la tabla está vacía
    const ratesCheck = await pool.query('SELECT COUNT(*) FROM exchange_rates');
    if (parseInt(ratesCheck.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO exchange_rates (eur_cop, usd_cop, eur_usd) 
        VALUES (4500, 4500, 1.05)
      `);
    }

    console.log('✅ Tablas de la base de datos REGENERADAS correctamente');
    
    // Cargar tasas de cambio desde la base de datos
    await loadExchangeRatesFromDB();
  } catch (error) {
    console.error('❌ Error inicializando la base de datos:', error);
  }
}

// Función para cargar tasas de cambio desde la base de datos
async function loadExchangeRatesFromDB() {
  try {
    if (DISABLE_DB) {
      return; // Si la BD está deshabilitada, usar valores por defecto
    }
    
    const result = await pool.query('SELECT eur_cop, usd_cop, eur_usd FROM exchange_rates ORDER BY updated_at DESC LIMIT 1');
    
    if (result.rows.length > 0) {
      const rates = result.rows[0];
      exchangeRates.EUR.COP = parseFloat(rates.eur_cop);
      exchangeRates.USD.COP = parseFloat(rates.usd_cop);
      exchangeRates.EUR.USD = parseFloat(rates.eur_usd);
      
      // Recalculamos las inversas
      exchangeRates.COP.EUR = 1 / exchangeRates.EUR.COP;
      exchangeRates.COP.USD = 1 / exchangeRates.USD.COP;
      exchangeRates.USD.EUR = 1 / exchangeRates.EUR.USD;
      
      console.log('✅ Tasas de cambio cargadas desde la base de datos:', exchangeRates);
    }
  } catch (error) {
    console.error('Error cargando tasas de cambio desde BD:', error);
  }
}

// Funciones para interactuar con la base de datos

// Función para obtener un usuario por su nombre de usuario
async function getUserByUsername(username) {
  try {
    if (DISABLE_DB) {
      const userLocal = inMemoryUsers.get(username.toLowerCase());
      if (!userLocal) {
        return null;
      }
      return {
        credits: parseFloat(userLocal.credits || 0),
        currency: userLocal.currency || 'EUR',
        avatar_url: userLocal.avatar_url || ''
      };
    }
    
    if (!pool) {
      console.error('❌ Error: Pool de base de datos no está disponible en getUserByUsername');
      return null;
    }
    
    // La consulta ahora busca por 'username', que sí existe en tu tabla.
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length > 0) {
      // Usuario existe, lo retornamos
      return {
        credits: parseFloat(result.rows[0].credits),
        currency: result.rows[0].currency,
        avatar_url: result.rows[0].avatar_url
      };
    } else {
      // Si el usuario no se encuentra, lanzamos un error en lugar de crearlo aquí.
      throw new Error(`Usuario '${username}' no encontrado en la base de datos.`);
    }
  } catch (error) {
    console.error('Error obteniendo usuario por nombre:', error);
    // Devolvemos null para indicar que la operación falló.
    return null;
  }
}

// Función para obtener todos los usuarios
async function getAllUsersFromDB() {
  try {
    if (DISABLE_DB) {
      return Array.from(inMemoryUsers.values()).map(row => ({
        id: 'user_' + row.username.toLowerCase(),
        username: row.username,
        credits: parseFloat(row.credits || 0),
        currency: row.currency || 'EUR'
      }));
    }
    const result = await pool.query('SELECT username, credits, currency FROM users ORDER BY username ASC');
    return result.rows.map(row => ({
      id: 'user_' + row.username.toLowerCase(),
      username: row.username,
      credits: parseFloat(row.credits),
      currency: row.currency
    }));
  } catch (error) {
    console.error('Error obteniendo todos los usuarios de la BD:', error);
    return [];
  }
}

// Función para actualizar créditos de un usuario (ignora mayúsculas)
async function updateUserCredits(userId, credits, currency) {
  try {
    if (DISABLE_DB) {
      const username = userId.replace(/^user_/, '');
      const user = inMemoryUsers.get(username);
      if (user) {
        user.credits = credits;
        user.currency = currency;
        inMemoryUsers.set(username, user);
      }
      return;
    }
    // Extraer el username del userId (formato: user_username), que ya viene en minúsculas.
    const username = userId.replace(/^user_/, '');
    // Usamos LOWER(username) para asegurar que encontramos al usuario correcto.
    await pool.query(
      'UPDATE users SET credits = $1, currency = $2 WHERE LOWER(username) = $3',
      [credits, currency, username]
    );
    console.log(`✅ Créditos actualizados para usuario ${userId}: ${credits} ${currency}`);
  } catch (error) {
    console.error('Error actualizando créditos:', error);
  }
}

// Función para eliminar un usuario de la base de datos (ignora mayúsculas)
async function deleteUserFromDB(username) {
  try {
    if (DISABLE_DB) {
      return inMemoryUsers.delete(username);
    }
    // Usamos LOWER(username) para asegurar la coincidencia sin importar mayúsculas/minúsculas.
    // El username que llega ya está en minúsculas, así que la comparación es segura.
    const result = await pool.query('DELETE FROM users WHERE LOWER(username) = $1', [username]);
    console.log(`✅ Usuario '${username}' eliminado de la base de datos. Filas afectadas: ${result.rowCount}`);
    return result.rowCount > 0;
  } catch (error) {
    console.error(`❌ Error eliminando al usuario '${username}' de la BD:`, error);
    return false;
  }
}

// ▼▼▼ FUNCIÓN PARA ACTUALIZAR EL AVATAR DE UN USUARIO ▼▼▼
// Función para actualizar el avatar de un usuario
async function updateUserAvatar(userId, avatarUrl) {
  try {
    if (DISABLE_DB) {
      const username = userId.replace(/^user_/, '');
      const user = inMemoryUsers.get(username);
      if (user) {
        user.avatar_url = avatarUrl;
        inMemoryUsers.set(username, user);
      }
      return;
    }
    // Extraer el username del userId (formato: user_username), que ya viene en minúsculas.
    const username = userId.replace(/^user_/, '');
    // Usamos LOWER(username) para asegurar que encontramos al usuario correcto.
    await pool.query(
      'UPDATE users SET avatar_url = $1 WHERE LOWER(username) = $2',
      [avatarUrl, username]
    );
    console.log(`✅ Avatar actualizado para usuario ${userId}`);
  } catch (error) {
    console.error('Error actualizando avatar:', error);
  }
}
// ▲▲▲ FIN DE LA FUNCIÓN updateUserAvatar ▲▲▲

// ▼▼▼ FUNCIÓN PARA ACTUALIZAR LA CONTRASEÑA DE UN USUARIO ▼▼▼
// Función para actualizar la contraseña de un usuario
async function updateUserPassword(username, newPassword) {
  try {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    if (DISABLE_DB) {
      const user = inMemoryUsers.get(username.toLowerCase());
      if (user) {
        user.password_hash = newPassword;
        inMemoryUsers.set(username.toLowerCase(), user);
      }
      return true;
    }
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE LOWER(username) = $2',
      [passwordHash, username.toLowerCase()]
    );
    console.log(`✅ Contraseña actualizada para el usuario ${username}`);
    return true;
  } catch (error) {
    console.error(`❌ Error actualizando la contraseña para ${username}:`, error);
    return false;
  }
}
// ▲▲▲ FIN DE LA FUNCIÓN ▲▲▲

// ▼▼▼ FUNCIÓN PARA OBTENER DATOS COMPLETOS DE TODOS LOS USUARIOS ▼▼▼
// Función para obtener TODOS los datos de TODOS los usuarios
async function getFullUsersFromDB() {
  try {
    if (DISABLE_DB) {
      return Array.from(inMemoryUsers.values()).map(row => ({
        id: row.id || 0,
        username: row.username,
        credits: parseFloat(row.credits || 0),
        currency: row.currency || 'EUR',
        avatar_url: row.avatar_url,
        country: row.country || '',
        whatsapp: row.whatsapp || '',
        created_at: row.created_at || new Date().toISOString(),
        accepted_terms_at: row.accepted_terms_at || null,
        accepted_privacy_at: row.accepted_privacy_at || null
      }));
    }
    const result = await pool.query('SELECT id, username, credits, currency, avatar_url, country, whatsapp, created_at, accepted_terms_at, accepted_privacy_at FROM users ORDER BY username ASC');
    return result.rows.map(row => ({
      ...row,
      credits: parseFloat(row.credits) // Aseguramos que los créditos sean numéricos
    }));
  } catch (error) {
    console.error('Error obteniendo la lista completa de usuarios de la BD:', error);
    return [];
  }
}
// ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲

// Función para guardar comisión
async function saveCommission(amount, currency = 'COP') {
  try {
    const newEntry = {
      id: commissionLog.length + 1,
      amount,
      currency,
      timestamp: Date.now()
    };
    
    if (DISABLE_DB) {
      commissionLog.push(newEntry);
      return;
    }
    
    await pool.query(
      'INSERT INTO commission_log (amount, currency) VALUES ($1, $2)',
      [amount, currency]
    );
    
    // Actualizar el array en memoria incluso cuando se usa BD
    commissionLog.push(newEntry);
    
    console.log(`✅ Comisión guardada: ${amount} ${currency}`);
  } catch (error) {
    console.error('Error guardando comisión:', error);
  }
}

// Función para guardar mensaje del lobby
async function saveLobbyMessage(messageId, sender, message) {
  try {
    if (DISABLE_DB) {
      lobbyChatHistory.unshift({
        id: messageId,
        from: sender,
        text: message,
        ts: Date.now()
      });
      if (lobbyChatHistory.length > LOBBY_CHAT_HISTORY_LIMIT) {
        lobbyChatHistory.pop();
      }
      return;
    }
    await pool.query(
      'INSERT INTO lobby_chat (message_id, sender, message) VALUES ($1, $2, $3)',
      [messageId, sender, message]
    );
  } catch (error) {
    console.error('Error guardando mensaje del lobby:', error);
  }
}

// Función para obtener historial del chat del lobby
async function getLobbyChatHistory() {
  try {
    if (DISABLE_DB) {
      return lobbyChatHistory.slice(0, LOBBY_CHAT_HISTORY_LIMIT);
    }
    const result = await pool.query(
      'SELECT message_id, sender, message, timestamp FROM lobby_chat ORDER BY timestamp DESC LIMIT 50'
    );
    return result.rows.map(row => ({
      id: row.message_id,
      from: row.sender,
      text: row.message,
      ts: new Date(row.timestamp).getTime()
    }));
  } catch (error) {
    console.error('Error obteniendo historial del lobby:', error);
    return [];
  }
}

function handleHostLeaving(room, leavingPlayerId, io) {
    if (room && room.hostId === leavingPlayerId) {
        // El anfitrión se va; buscamos un nuevo anfitrión entre los jugadores sentados.
        const newHost = room.seats.find(s => s && s.playerId !== leavingPlayerId);

        if (newHost) {
            room.hostId = newHost.playerId;
            console.log(`Anfitrión ${leavingPlayerId} ha salido. Nuevo anfitrión: ${newHost.playerName}.`);

            // Notificamos a todos en la sala del cambio para actualizar la UI.
            io.to(room.roomId).emit('newHostAssigned', {
                hostName: newHost.playerName,
                hostId: newHost.playerId
            });

            // --- INICIO DE LA MODIFICACIÓN ---
            // Si el cambio de anfitrión ocurre durante la fase de revancha,
            // el servidor recalcula y envía proactivamente el estado actualizado a todos.
            if (room.state === 'post-game') {
                const readyPlayerIds = new Set();
                room.rematchRequests.forEach(id => readyPlayerIds.add(id));
                room.seats.forEach(seat => {
                    if (seat && seat.status === 'waiting') {
                        readyPlayerIds.add(seat.playerId);
                    }
                });

                const playersReadyNames = Array.from(readyPlayerIds).map(id => {
                    const seat = room.seats.find(s => s && s.playerId === id);
                    return seat ? seat.playerName : null;
                }).filter(Boolean);

                const totalPlayersReady = readyPlayerIds.size;

                // Emitimos la actualización con el ID del nuevo anfitrión.
                io.to(room.roomId).emit('rematchUpdate', {
                    playersReady: playersReadyNames,
                    canStart: totalPlayersReady >= 2,
                    hostId: room.hostId // El ID del nuevo anfitrión.
                });
                console.log(`[Re-Host] Actualización de revancha enviada. Nuevo anfitrión: ${room.hostId}`);
            }
            // --- FIN DE LA MODIFICACIÓN ---
        }
    }
}

function checkAndCleanRoom(roomId, io) {
    const room = la51Rooms[roomId];
    if (!room) {
        // Si la sala ya no existe, aun así notificamos a todos para que actualicen su lista.
        broadcastRoomListUpdate(io);
        return;
    }

    const playersInSeats = room.seats.filter(s => s !== null).length;

    // UNA SALA ESTÁ VACÍA SI NO HAY NADIE EN LOS ASIENTOS.
    if (playersInSeats === 0) {
        console.log(`Mesa ${roomId} está completamente vacía. Eliminando...`);
        delete la51Rooms[roomId];
    }

    // Se emite la actualización SIEMPRE que un jugador sale,
    // para que el contador (ej: 3/4 -> 2/4) se actualice en tiempo real.
    broadcastRoomListUpdate(io);
}

// ▼▼▼ FUNCIÓN CORREGIDA PARA ACTUALIZAR LISTA DE USUARIOS ▼▼▼
function broadcastUserListUpdate(io) {
    // Limpieza básica
    Object.keys(connectedUsers).forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket || !socket.connected) {
            delete connectedUsers[socketId];
        }
    });
    
    const userList = Object.keys(connectedUsers).map(socketId => {
            const user = { ...connectedUsers[socketId] };
        // Aseguramos que el estado visual coincida con la lógica interna
        if (user.currentLobby === 'Ludo' && !user.status.includes('Jugando')) {
            user.status = 'En el lobby de Ludo';
        } else if (user.currentLobby === 'La 51' && !user.status.includes('Jugando')) {
            user.status = 'En el lobby de La 51';
        }
            return user;
    }).filter(u => u && u.username); // Filtro simple
    
    console.log(`[User List] Preparando lista de ${userList.length} usuarios. Usuarios en connectedUsers:`, Object.keys(connectedUsers).length);
    console.log(`[User List] Detalles de usuarios:`, userList.map(u => ({ username: u.username, status: u.status })));
    io.emit('updateUserList', userList);
    console.log(`[User List] ✅ Lista transmitida a todos los clientes: ${userList.length} usuarios.`);
}
// ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

// Nota: getSanitizedRoomForClient está definida en línea 3392 (versión completa con pot y chatHistory)

function generateRoomId() {
  // Crea un ID aleatorio y único para cada mesa, ej: 'room-a1b2c3d4'
  return `room-${Math.random().toString(36).slice(2, 10)}`;
}

let la51Rooms = {}; // Estado de las mesas de La 51 se mantiene en memoria
let ludoRooms = {}; // Estado de las mesas de Ludo se mantiene en memoria
let connectedUsers = {}; // Objeto para rastrear usuarios activos

let lobbyChatHistory = []; // Chat del lobby general (compartido)
let ludoLobbyChatHistory = []; // Chat específico del lobby de Ludo
let la51LobbyChatHistory = []; // Chat específico del lobby de La 51
const LOBBY_CHAT_HISTORY_LIMIT = 50; // Guardaremos los últimos 50 mensajes
let ludoChatLastMessageTime = 0; // Timestamp del último mensaje en el chat de Ludo
let la51ChatLastMessageTime = 0; // Timestamp del último mensaje en el chat de La 51
const CHAT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos en milisegundos
// ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

// ▼▼▼ VARIABLES GLOBALES PARA LUDO ▼▼▼
let ludoReconnectTimeouts = {}; // Mapa para rastrear timeouts de reconexión de Ludo: {roomId_userId: timeoutId}
const LUDO_RECONNECT_TIMEOUT_MS = 120000; // 120 segundos (2 minutos) para reconexión en partida activa
const LUDO_ORPHAN_ROOM_CLEANUP_INTERVAL_MS = 5000; // Limpiar salas huérfanas cada 5 segundos
let ludoPeriodicCleanupInterval = null; // Intervalo para limpieza periódica (solo cuando hay salas vacías)
// ▼▼▼ TIMEOUT DE INACTIVIDAD: 2 minutos sin acción durante el turno ▼▼▼
const LUDO_INACTIVITY_TIMEOUT_MS = 120000; // 120 segundos (2 minutos) de inactividad antes de eliminar por falta
let ludoInactivityTimeouts = {}; // { `${roomId}_${playerId}`: timeoutId }
let ludoDisconnectedPlayers = {}; // { `${roomId}_${userId}`: { disconnectedAt: timestamp, seatIndex: number } }
// ▼▼▼ SISTEMA GLOBAL DE PENALIZACIONES: Rastrear penalizaciones aplicadas incluso si la sala ya no existe ▼▼▼
let ludoGlobalPenaltyApplied = {}; // { `${roomId}_${userId}`: true } - Para rastrear penalizaciones incluso si la sala fue eliminada
// ▲▲▲ FIN SISTEMA GLOBAL DE PENALIZACIONES ▲▲▲
// ▲▲▲ FIN VARIABLES GLOBALES PARA LUDO ▲▲▲

// ▼▼▼ VARIABLES GLOBALES PARA LA 51 ▼▼▼
let la51DisconnectedPlayers = {}; // { `${roomId}_${userId}`: { disconnectedAt: timestamp, seatIndex: number, playerId: string } }
// ▼▼▼ TIMEOUT DE INACTIVIDAD: 2 minutos sin acción durante el turno ▼▼▼
const LA51_INACTIVITY_TIMEOUT_MS = 120000; // 120 segundos (2 minutos) de inactividad antes de eliminar por falta
let la51InactivityTimeouts = {}; // { `${roomId}_${playerId}`: timeoutId }
let la51EliminatedPlayers = {}; // { `${roomId}_${userId}`: { playerName, reason, faultData, penaltyInfo } } - Para rastrear jugadores eliminados por inactividad
// ▲▲▲ FIN TIMEOUT DE INACTIVIDAD ▲▲▲
// ▲▲▲ FIN VARIABLES GLOBALES PARA LA 51 ▲▲▲

let reconnectTimeouts = {}; // Para rastrear los tiempos de reconexión
const RECONNECT_TIMEOUT_MS = 120000; // 120 segundos (2 minutos) para reconectar en partida activa

// ▼▼▼ FUNCIONES HELPER PARA TIMEOUT DE INACTIVIDAD EN LA 51 (COPIADO EXACTAMENTE DE LUDO) ▼▼▼
// NOTA: No hay funciones separadas, la lógica está integrada directamente en advanceTurnAfterAction
// igual que en ludoPassTurn
// ▲▲▲ FIN FUNCIONES HELPER PARA TIMEOUT DE INACTIVIDAD ▲▲▲


// ▼▼▼ AÑADE ESTAS LÍNEAS ▼▼▼
let users = {}; // Reemplazará a userCredits para guardar más datos
let exchangeRates = {
    'EUR': { 'USD': 1.05, 'COP': 4500 },
    'USD': { 'EUR': 1 / 1.05, 'COP': 4500 },
    'COP': { 'EUR': 1 / 4500, 'USD': 1 / 4500 }
};
// ▲▲▲ FIN DEL CÓDIGO A AÑADIR ▲▲▲

let commissionLog = []; // <--- REEMPLAZA totalCommission por esto

// ▼▼▼ AÑADE ESTA FUNCIÓN COMPLETA ▼▼▼
function convertCurrency(amount, fromCurrency, toCurrency, rates) {
    if (fromCurrency === toCurrency) {
        return amount;
    }
    // Si la tasa directa existe, la usamos.
    if (rates[fromCurrency] && rates[fromCurrency][toCurrency]) {
        return amount * rates[fromCurrency][toCurrency];
    }
    // Si no, intentamos la inversa (ej. de COP a EUR)
    if (rates[toCurrency] && rates[toCurrency][fromCurrency]) {
         return amount / rates[toCurrency][fromCurrency];
    }
    // Fallback si no hay tasa (no debería pasar con tu configuración)
    return amount; 
}
// ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲

// ▼▼▼ AÑADE ESTA NUEVA FUNCIÓN JUSTO AQUÍ ▼▼▼
function broadcastRoomListUpdate(io) {
    io.emit('updateRoomList', Object.values(la51Rooms));
    console.log('[Broadcast] Se ha actualizado la lista de mesas para todos los clientes.');
}
// ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲

// ▼▼▼ FUNCIONES AUXILIARES DE LUDO (copiadas de ludoserver.js, cambiando rooms por ludoRooms) ▼▼▼
// Función para manejar cuando el host deja la sala
function ludoHandleHostLeaving(room, leavingPlayerId, io) {
    if (room && room.hostId === leavingPlayerId) {
        const newHost = room.seats.find(s => s && s.playerId !== leavingPlayerId);

        if (newHost) {
            room.hostId = newHost.playerId;
            console.log(`[Ludo] Anfitrión ${leavingPlayerId} ha salido. Nuevo anfitrión: ${newHost.playerName}.`);

            io.to(room.roomId).emit('newHostAssigned', {
                hostName: newHost.playerName,
                hostId: newHost.playerId
            });
        }
    }
}

// Función helper para limpiar una reconexión específica (reconnectSeats + timeout)
function ludoClearReconnection(roomId, userId) {
    const timeoutKey = `${roomId}_${userId}`;
    if (ludoReconnectTimeouts[timeoutKey]) {
        clearTimeout(ludoReconnectTimeouts[timeoutKey]);
        delete ludoReconnectTimeouts[timeoutKey];
        console.log(`[Ludo Cleanup] Timeout de reconexión limpiado para ${userId} en sala ${roomId}`);
    }
    
    const room = ludoRooms[roomId];
    if (room && room.reconnectSeats && room.reconnectSeats[userId]) {
        delete room.reconnectSeats[userId];
        if (Object.keys(room.reconnectSeats).length === 0) {
            delete room.reconnectSeats;
        }
    }
}

// Función para limpiar timeouts de reconexión expirados en una sala
function ludoCleanupExpiredReconnections(roomId, io) {
    const room = ludoRooms[roomId];
    if (!room || !room.reconnectSeats) return;

    const now = Date.now();
    const expiredUserIds = [];

    for (const [userId, reconnectData] of Object.entries(room.reconnectSeats)) {
        // IMPORTANTE: Solo limpiar si el timeout ya se ejecutó (verificar que NO hay timeout activo)
        // El timeout de abandono es el que debe ejecutar la lógica de eliminación, no esta función
        const timeoutKey = `${roomId}_${userId}`;
        const hasActiveTimeout = ludoReconnectTimeouts[timeoutKey] || (room.abandonmentTimeouts && room.abandonmentTimeouts[userId]);
        
        // Solo limpiar si NO hay timeout activo Y el tiempo ha expirado
        // Esto significa que el timeout ya se ejecutó y procesó el abandono
        if (!hasActiveTimeout && reconnectData.timestamp && (now - reconnectData.timestamp > LUDO_RECONNECT_TIMEOUT_MS)) {
            expiredUserIds.push(userId);
        }
    }

    // Limpiar reconexiones expiradas (solo datos residuales, no jugadores activos)
    expiredUserIds.forEach(userId => {
        console.log(`[Ludo Cleanup] Limpiando datos residuales de reconexión expirada para usuario ${userId} en sala ${roomId}`);
        ludoClearReconnection(roomId, userId);
    });
}

// Función para verificar si hay sockets conectados a una sala
function ludoHasConnectedSockets(roomId, io) {
    try {
        const room = io.sockets.adapter.rooms.get(roomId);
        return room ? room.size > 0 : false;
    } catch (error) {
        console.error(`[ludoHasConnectedSockets] Error verificando sockets para ${roomId}:`, error);
        return false;
    }
}

// Función para verificar y limpiar salas vacías
function ludoCheckAndCleanRoom(roomId, io) {
    const room = ludoRooms[roomId];

    if (!room) {
        console.log(`[Ludo Cleanup] Sala ${roomId} ya no existe.`);
        broadcastLudoRoomListUpdate(io); // Notificar por si acaso
        return;
    }

    // 0. Limpiar reconexiones expiradas primero
    ludoCleanupExpiredReconnections(roomId, io);

    // 1. Contar jugadores en los asientos.
    const playersInSeats = room.seats.filter(s => s !== null).length;

    // 3. Contar reconexiones pendientes (después de limpiar expiradas)
    const pendingReconnections = room.reconnectSeats ? Object.keys(room.reconnectSeats).length : 0;

    // 4. Verificar si hay sockets conectados a la sala que correspondan a jugadores en los asientos
    const hasSockets = ludoHasConnectedSockets(roomId, io);
    
    // Verificar si los sockets conectados corresponden a jugadores en los asientos
    let hasValidSockets = false;
    if (hasSockets && playersInSeats > 0) {
        try {
            const roomSockets = io.sockets.adapter.rooms.get(roomId);
            if (roomSockets) {
                // Verificar si algún socket conectado corresponde a un jugador en los asientos
                for (const socketId of roomSockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                        // Verificar si este userId está en algún asiento
                        const isInSeat = room.seats.some(s => s && s.userId === socketUserId);
                        if (isInSeat) {
                            hasValidSockets = true;
                            break;
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`[Ludo Cleanup] Error verificando sockets válidos para ${roomId}:`, error);
        }
    }

    // 5. Verificar si la sala fue creada recientemente (últimos 15 segundos)
    const roomCreatedAt = room.createdAt || 0;
    const now = Date.now();
    const roomAge = now - roomCreatedAt;
    const RECENT_ROOM_THRESHOLD = 15000; // 15 segundos
    const isRecentRoom = roomAge < RECENT_ROOM_THRESHOLD;

    // 6. Lógica de eliminación mejorada
    // Si no hay jugadores en los asientos, no hay reconexiones pendientes, no hay sockets válidos (o no hay sockets), y la sala no es reciente, eliminar
    if (playersInSeats === 0 && pendingReconnections === 0 && (!hasSockets || !hasValidSockets) && !isRecentRoom) {
        // SOLO si no hay jugadores, no hay reconexiones pendientes, no hay sockets conectados, Y la sala no es reciente
        console.log(`[Ludo Cleanup] Sala ${roomId} vacía (Jugadores: 0, Reconexiones: 0, Sockets: 0, Edad: ${Math.round(roomAge/1000)}s). Eliminando AHORA.`);
        
        // Limpiar todos los timeouts relacionados con esta sala
        Object.keys(ludoReconnectTimeouts).forEach(key => {
            if (key.startsWith(`${roomId}_`)) {
                clearTimeout(ludoReconnectTimeouts[key]);
                delete ludoReconnectTimeouts[key];
            }
        });
        
        delete ludoRooms[roomId];
    } else {
        console.log(`[Ludo Cleanup] Mesa ${roomId} no se elimina (Jugadores: ${playersInSeats}, Reconexiones: ${pendingReconnections}, Sockets conectados: ${hasSockets}, Sockets válidos: ${hasValidSockets}, Reciente: ${isRecentRoom}).`);
        
        // Si la sala está vacía pero tiene reconexiones pendientes, sockets válidos o es reciente, activar limpieza periódica
        if (playersInSeats === 0 && (pendingReconnections > 0 || hasValidSockets || isRecentRoom)) {
            ludoStartPeriodicCleanup(io);
        }
    }

    // 5. Notificar a todos los clientes del lobby sobre el cambio
    broadcastLudoRoomListUpdate(io);
}

// Función para actualizar lista de salas de Ludo
// ▼▼▼ FUNCIÓN PARA TRANSMITIR SALAS DE LUDO ▼▼▼
function broadcastLudoRoomListUpdate(io) {
    // 1. Emite a un evento NUEVO llamado 'updateLudoRoomList'
    // 2. Envía la lista de 'ludoRooms' (NO la51Rooms)
    const roomsArray = Object.values(ludoRooms);
    console.log(`[Broadcast LUDO] Emitiendo ${roomsArray.length} salas de Ludo a todos los clientes.`);
    io.emit('updateLudoRoomList', roomsArray);
    console.log('[Broadcast LUDO] Lista de mesas de LUDO actualizada y emitida.');
}
// ▲▲▲ FIN DE LA FUNCIÓN ▲▲▲

// Función para obtener información sanitizada de la sala (sin datos sensibles)
function ludoGetSanitizedRoomForClient(room) {
    if (!room) return null;

    const sanitizedRoom = {
        roomId: room.roomId,
        hostId: room.hostId,
        settings: room.settings,
        seats: room.seats,
        state: room.state,
        spectators: room.spectators || [],
        gameState: room.gameState
    };
    
    return sanitizedRoom;
}

// Función para generar ID de sala de Ludo
function ludoGenerateRoomId() {
  return `ludo-room-${Math.random().toString(36).slice(2, 10)}`;
}

// ▼▼▼ NUEVA FUNCIÓN HELPER PARA ASIGNACIÓN INTELIGENTE DE ASIENTOS ▼▼▼

/**
 * Encuentra el mejor índice de asiento disponible basándose en reglas de Ludo/Parchís:
 * 1. Si hay 1 jugador, busca la diagonal.
 * 2. Si no, busca equilibrar la mesa relativo al host.
 * 3. Fallback al primer hueco vacío.
 */
function findBestLudoSeat(room) {
    if (!room || !room.seats) return -1;

    // 1. Definir asientos ocupados
    const seatedPlayers = room.seats.filter(s => s !== null);
    const hostSeatIndex = room.settings.hostSeatIndex;

    // REGLA 1: DIAGONAL OBLIGATORIA (Si solo hay 1 jugador sentado)
    if (seatedPlayers.length === 1) {
        const existingPlayerIndex = room.seats.findIndex(s => s !== null);
        if (existingPlayerIndex !== -1) {
            const diagonalSeat = (existingPlayerIndex + 2) % 4;
            if (room.seats[diagonalSeat] === null) {
                console.log(`[SeatLogic] Asignando diagonal: ${existingPlayerIndex} -> ${diagonalSeat}`);
                return diagonalSeat;
            }
        }
    }

    // REGLA 2: PRIORIDAD RELATIVA AL HOST (Para 3 o 4 jugadores)
    // Intentamos llenar en orden: Diagonal del Host -> Izquierda del Host -> Derecha del Host
    // Esto asegura que la mesa se llene visualmente equilibrada.
    const priorityOrder = [
        (hostSeatIndex + 2) % 4, // Diagonal (Frente)
        (hostSeatIndex + 1) % 4, // Izquierda
        (hostSeatIndex + 3) % 4  // Derecha
    ];

    for (const index of priorityOrder) {
        if (room.seats[index] === null) {
            return index;
        }
    }

    // REGLA 3: FALLBACK (Cualquier asiento vacío)
    // Si la lógica anterior falla (ej. el host se fue y los índices cambiaron),
    // devolvemos el primer hueco que encontremos.
    return room.seats.findIndex(s => s === null);
}
// ▲▲▲ FIN DE LA NUEVA FUNCIÓN ▲▲▲

// Función para verificar si hay salas vacías esperando limpieza
function ludoHasEmptyRooms(io) {
    const roomIds = Object.keys(ludoRooms);
    
    for (const roomId of roomIds) {
        const room = ludoRooms[roomId];
        if (!room) continue;

        const playersInSeats = room.seats.filter(s => s !== null).length;
        const pendingReconnections = room.reconnectSeats ? Object.keys(room.reconnectSeats).length : 0;
        const hasSockets = ludoHasConnectedSockets(roomId, io);

        // Una sala está "vacía esperando limpieza" si no tiene jugadores pero tiene reconexiones pendientes o sockets
        if (playersInSeats === 0 && (pendingReconnections > 0 || hasSockets)) {
            return true;
        }
    }
    
    return false;
}

// Inicia la limpieza periódica de salas huérfanas
function ludoStartPeriodicCleanup(io) {
    if (ludoPeriodicCleanupInterval !== null) {
        return; // Ya está activo
    }
    
    ludoPeriodicCleanupInterval = setInterval(() => {
        ludoPeriodicOrphanRoomCleanup(io);
    }, LUDO_ORPHAN_ROOM_CLEANUP_INTERVAL_MS);
    
    console.log(`[Ludo Periodic Cleanup] Activando limpieza periódica (hay salas vacías esperando limpieza)`);
}

// Detiene la limpieza periódica de salas huérfanas
function ludoStopPeriodicCleanup() {
    if (ludoPeriodicCleanupInterval !== null) {
        clearInterval(ludoPeriodicCleanupInterval);
        ludoPeriodicCleanupInterval = null;
        console.log(`[Ludo Periodic Cleanup] Deteniendo limpieza periódica (no hay salas vacías)`);
    }
}

// Función para limpieza periódica de salas huérfanas
function ludoPeriodicOrphanRoomCleanup(io) {
    console.log(`[Ludo Periodic Cleanup] Iniciando limpieza de salas huérfanas...`);
    const roomIds = Object.keys(ludoRooms);
    let cleanedCount = 0;

    roomIds.forEach(roomId => {
        const room = ludoRooms[roomId];
        if (!room) return;

        // Limpiar reconexiones expiradas
        ludoCleanupExpiredReconnections(roomId, io);

        // Verificar condiciones de eliminación
        const playersInSeats = room.seats.filter(s => s !== null).length;
        const pendingReconnections = room.reconnectSeats ? Object.keys(room.reconnectSeats).length : 0;
        const hasSockets = ludoHasConnectedSockets(roomId, io);
        
        // ▼▼▼ CORRECCIÓN: Verificar también timeouts de reconexión activos ▼▼▼
        const hasActiveReconnectTimeouts = Object.keys(ludoReconnectTimeouts).some(key => key.startsWith(`${roomId}_`));
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

        // Solo eliminar si NO hay jugadores, NO hay reconexiones pendientes, NO hay sockets conectados Y NO hay timeouts activos
        if (playersInSeats === 0 && pendingReconnections === 0 && !hasSockets && !hasActiveReconnectTimeouts) {
            console.log(`[Ludo Periodic Cleanup] Eliminando sala huérfana: ${roomId}`);
            delete ludoRooms[roomId];
            
            // Limpiar todos los timeouts relacionados con esta sala
            Object.keys(ludoReconnectTimeouts).forEach(key => {
                if (key.startsWith(`${roomId}_`)) {
                    clearTimeout(ludoReconnectTimeouts[key]);
                    delete ludoReconnectTimeouts[key];
                }
            });
            
            cleanedCount++;
        } else {
            console.log(`[Ludo Periodic Cleanup] Sala ${roomId} no se elimina (Jugadores: ${playersInSeats}, Reconexiones: ${pendingReconnections}, Sockets: ${hasSockets}, Timeouts activos: ${hasActiveReconnectTimeouts})`);
        }
    });

    if (cleanedCount > 0) {
        console.log(`[Ludo Periodic Cleanup] Se eliminaron ${cleanedCount} sala(s) huérfana(s).`);
        broadcastLudoRoomListUpdate(io);
    } else {
        console.log(`[Ludo Periodic Cleanup] No se encontraron salas huérfanas.`);
    }

    // Si no hay salas vacías esperando limpieza, detener la limpieza periódica
    if (!ludoHasEmptyRooms(io)) {
        ludoStopPeriodicCleanup();
    }
}

// Funciones auxiliares de Ludo extraídas y adaptadas

// === handlePlayerDeparture ===
async function ludoHandlePlayerDeparture(roomId, leavingPlayerId, io, isVoluntaryAbandonment = false, isInactivityTimeout = false) {
    const room = ludoRooms[roomId];

    if (!room) return;

    console.log(`Gestionando salida del jugador ${leavingPlayerId} de la sala ${roomId}. ${isVoluntaryAbandonment ? '(ABANDONO VOLUNTARIO - PROCESAR INMEDIATAMENTE)' : ''} ${isInactivityTimeout ? '(ELIMINADO POR INACTIVIDAD - EXPULSAR AL LOBBY)' : ''}`);
    
    // Declarar roomCurrency al inicio para evitar duplicación
    const roomCurrency = room.settings.betCurrency || 'USD';

    if (room.spectators) {
        room.spectators = room.spectators.filter(s => s.playerId !== leavingPlayerId);
    }

    // ▼▼▼ CRÍTICO: Buscar asiento por playerId primero, pero si no se encuentra y es por inactividad, buscar por userId ▼▼▼
    let seatIndex = room.seats.findIndex(s => s && s.playerId === leavingPlayerId);
    
    // Si no se encuentra por playerId y es por inactividad, buscar por userId (el jugador puede estar desconectado)
    if (seatIndex === -1 && isInactivityTimeout) {
        // Buscar el userId del leavingPlayerId si es un socket
        let targetUserId = null;
        const socket = io.sockets.sockets.get(leavingPlayerId);
        if (socket) {
            targetUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
        }
        
        // Si tenemos userId, buscar el asiento por userId
        if (targetUserId) {
            seatIndex = room.seats.findIndex(s => s && s.userId === targetUserId);
            console.log(`[${roomId}] Jugador no encontrado por playerId, buscando por userId ${targetUserId}. Asiento encontrado: ${seatIndex}`);
        }
    }
    
    if (seatIndex === -1) {
        console.log(`[${roomId}] ⚠️ No se encontró el asiento del jugador ${leavingPlayerId}. Puede que ya haya sido eliminado.`);
        io.to(roomId).emit('spectatorListUpdated', { spectators: room.spectators });
        ludoCheckAndCleanRoom(roomId, io);
        return;
    }
    // ▲▲▲ FIN BÚSQUEDA MEJORADA DE ASIENTO ▲▲▲
    
    const leavingPlayerSeat = { ...room.seats[seatIndex] };
    const leavingPlayerUserId = leavingPlayerSeat.userId;
    
    // ▼▼▼ CANCELAR TIMEOUT DE INACTIVIDAD: El jugador está saliendo ▼▼▼
    // Cancelar timeout usando userId (preferido)
    if (leavingPlayerUserId) {
        const inactivityTimeoutKey = `${roomId}_${leavingPlayerUserId}`;
        if (ludoInactivityTimeouts[inactivityTimeoutKey]) {
            clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKey]);
            delete ludoInactivityTimeouts[inactivityTimeoutKey];
            console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${leavingPlayerUserId} (jugador está saliendo)`);
        }
    }
    
    // También cancelar usando leavingPlayerId (por si acaso)
    const inactivityTimeoutKeyByPlayerId = `${roomId}_${leavingPlayerId}`;
    if (ludoInactivityTimeouts[inactivityTimeoutKeyByPlayerId]) {
        clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKeyByPlayerId]);
        delete ludoInactivityTimeouts[inactivityTimeoutKeyByPlayerId];
        console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${leavingPlayerId} (jugador está saliendo, por playerId)`);
    }
    
    // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
    if (leavingPlayerUserId) {
        Object.keys(ludoInactivityTimeouts).forEach(key => {
            if (key.startsWith(`${roomId}_`) && (key.includes(leavingPlayerUserId) || key.includes(leavingPlayerId))) {
                clearTimeout(ludoInactivityTimeouts[key]);
                delete ludoInactivityTimeouts[key];
                console.log(`[${roomId}] ✓ Timeout adicional cancelado: ${key}`);
            }
        });
    }
    // ▲▲▲ FIN CANCELACIÓN TIMEOUT ▲▲▲
    const playerName = leavingPlayerSeat.playerName;
    const playerColor = leavingPlayerSeat.color; 

    // ▼▼▼ LÓGICA DE REASIGNACIÓN DE ANFITRIÓN DE REVANCHA ▼▼▼
    if (room.state === 'post-game' && room.rematchData && leavingPlayerSeat.playerId === room.rematchData.winnerId) {
        console.log(`[REMATCH] El anfitrión de la revancha (Ganador: ${leavingPlayerSeat.playerName}) ha salido.`);

        // 1. BUSCAR UN NUEVO HOST (Tu Lógica Requerida)
        // Primero, busca entre los jugadores que YA CONFIRMARON.
        let newHostSeat = null;
        if (room.rematchData.confirmedPlayers.length > 0) {
            newHostSeat = room.seats.find(s => 
                s && // Que el asiento exista
                s.playerId !== leavingPlayerId && // Que no sea el que se está yendo
                room.rematchData.confirmedPlayers.includes(s.playerName) // ¡QUE HAYA CONFIRMADO!
            );
        }

        // 2. FALLBACK (Si nadie ha confirmado, o los que confirmaron ya se fueron)
        // Busca CUALQUIER otro jugador que siga en la sala.
        if (!newHostSeat) {
            newHostSeat = room.seats.find(s => s && s.playerId !== leavingPlayerId);
        }

        // 3. ASIGNAR EL NUEVO HOST
        if (newHostSeat) {
            room.rematchData.winnerId = newHostSeat.playerId;
            room.rematchData.winnerName = newHostSeat.playerName; // ¡Actualiza el nombre!

            console.log(`[REMATCH] Nuevo anfitrión de revancha asignado: ${newHostSeat.playerName} (Socket ${newHostSeat.playerId})`);

            // 4. Notificar a todos en la sala (para que la UI del cliente se actualice)
            // Contar el total de jugadores (menos el que se está yendo)
            const expectedPlayers = room.seats.filter(s => s !== null).length - 1; 

            io.to(roomId).emit('rematchUpdate', {
                confirmedPlayers: room.rematchData.confirmedPlayers,
                canStart: room.rematchData.canStart,
                winnerName: room.rematchData.winnerName, // Envía el NUEVO nombre
                totalPlayers: expectedPlayers
            });
        } else {
            console.log(`[REMATCH] No se pudo reasignar anfitrión de revancha (no quedan jugadores).`);
            // La sala se limpiará sola si todos se van.
        }
    }
    // ▲▲▲ FIN: LÓGICA DE REASIGNACIÓN DE ANFITRIÓN DE REVANCHA ▲▲▲

    // ▼▼▼ CORRECCIÓN: Verificar si hay un timeout de reconexión activo antes de procesar abandono ▼▼▼
    // Si el jugador se desconectó durante una partida activa, el timeout de 2 minutos ya está configurado
    // NO debemos procesar el abandono inmediatamente aquí
    // PERO si es un abandono voluntario (leaveGame), procesar INMEDIATAMENTE sin esperar timeouts
    const timeoutKey = `${roomId}_${leavingPlayerSeat.userId}`;
    const hasActiveReconnectTimeout = ludoReconnectTimeouts[timeoutKey] || (room.abandonmentTimeouts && room.abandonmentTimeouts[leavingPlayerSeat.userId]);
    const isInReconnectSeats = room.reconnectSeats && room.reconnectSeats[leavingPlayerSeat.userId];
    
    // Si hay un timeout activo o está en reconnectSeats, NO procesar el abandono aquí
    // EXCEPTO si es un abandono voluntario (leaveGame), en cuyo caso procesar INMEDIATAMENTE
    if (!isVoluntaryAbandonment && (hasActiveReconnectTimeout || isInReconnectSeats)) {
        console.log(`[${roomId}] Jugador ${playerName} tiene timeout de reconexión activo. NO procesando abandono inmediato (esperando timeout de 2 minutos).`);
        return; // Salir de la función - el timeout se encargará del abandono
    }
    
    // Si es abandono voluntario O NO hay timeout activo, entonces procesar el abandono
    // Limpiar cualquier reconexión pendiente para este usuario
    if (ludoReconnectTimeouts[timeoutKey]) {
        clearTimeout(ludoReconnectTimeouts[timeoutKey]);
        delete ludoReconnectTimeouts[timeoutKey];
    }
    
    // Limpiar reconnectSeats si existe
    if (room.reconnectSeats && room.reconnectSeats[leavingPlayerSeat.userId]) {
        delete room.reconnectSeats[leavingPlayerSeat.userId];
        if (Object.keys(room.reconnectSeats).length === 0) {
            delete room.reconnectSeats;
        }
    }
    
    // Liberar el asiento (solo para abandonos intencionales, no para desconexiones)
    room.seats[seatIndex] = null;
    console.log(`[${roomId}] Jugador ${playerName} (asiento ${seatIndex}) abandonó la mesa ${isVoluntaryAbandonment ? 'VOLUNTARIAMENTE' : 'intencionalmente'}. Asiento liberado.`);
    // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

    if (room.state === 'playing' && leavingPlayerSeat.status !== 'waiting') {
        console.log(`Jugador activo ${playerName} ha abandonado durante el juego.`);
        
        // --- LÓGICA DE VICTORIA AUTOMÁTICA (PARCHÍS GRUPOS) ---
        const gameType = room.settings?.gameType;
        const parchisMode = room.settings?.parchisMode;

        // ▼▼▼ REEMPLAZA ESTE BLOQUE 'if' COMPLETO (aprox. líneas 514-622) ▼▼▼
        if (gameType === 'parchis' && parchisMode === '4-groups') {
            console.log(`[Parchís Grupos] Abandono detectado. ${playerName} (Asiento ${seatIndex}) ha abandonado. La pareja oponente gana.`);

            const opponentSeatIndex1 = (seatIndex + 1) % 4;
            const opponentSeatIndex2 = (seatIndex + 3) % 4;

            const opponentSeat1 = room.seats[opponentSeatIndex1];
            const opponentSeat2 = room.seats[opponentSeatIndex2];

            // --- INICIO DE LA CORRECCIÓN ---

            // 1. Definir el ANFITRIÓN DE LA REVANCHA (el primer socio oponente disponible)
            const rematchHostSeat = opponentSeat1 || opponentSeat2; // Prioriza al oponente 1
            const rematchHostId = rematchHostSeat ? rematchHostSeat.playerId : null;
            const rematchHostName = rematchHostSeat ? rematchHostSeat.playerName : 'Pareja Oponente'; // Nombre del host único
            const rematchHostColor = rematchHostSeat ? rematchHostSeat.color : playerColor;
            const rematchHostAvatar = rematchHostSeat ? rematchHostSeat.avatar : '';

            // 2. Definir el NOMBRE A MOSTRAR en el modal de victoria (puede ser ambos)
            const winnerDisplayName = (opponentSeat1 && opponentSeat2)
                ? `${opponentSeat1.playerName} & ${opponentSeat2.playerName}`
                : rematchHostName; // Si solo queda uno, se muestra ese

            // --- FIN DE LA CORRECCIÓN ---

            room.state = 'post-game';
            const totalPot = room.gameState.pot;
            const commission = totalPot * 0.10;
            const finalWinnings = totalPot - commission;

            // Guardar comisión en el log de administración (solo una vez por partida)
            const roomCurrency = room.settings.betCurrency || 'USD';
            if (!room.commissionSaved) {
                const commissionInCOP = convertCurrency(commission, roomCurrency, 'COP', exchangeRates);
                await saveCommission(commissionInCOP, 'COP');
                room.commissionSaved = true; // Marcar que ya se guardó la comisión
            }

            const winners = [opponentSeat1, opponentSeat2].filter(Boolean);
            const winningsPerPlayer = winners.length > 0 ? finalWinnings / winners.length : 0;
            const winningPlayersPayload = [];

            for (const seatInfo of winners) {
                if (!seatInfo) continue;
                // ▼▼▼ CORRECCIÓN CRÍTICA: Obtener userInfo desde users, BD o inMemoryUsers ▼▼▼
                const winnerUsername = seatInfo.userId ? seatInfo.userId.replace('user_', '') : null;
                let winnerInfo = seatInfo.userId ? users[seatInfo.userId] : null;
                
                // Si no está en users, intentar obtenerlo de la BD o inMemoryUsers
                if (!winnerInfo && seatInfo.userId) {
                    try {
                        if (DISABLE_DB) {
                            const userFromMemory = inMemoryUsers.get(winnerUsername);
                            if (userFromMemory) {
                                winnerInfo = {
                                    credits: parseFloat(userFromMemory.credits || 0),
                                    currency: userFromMemory.currency || 'EUR'
                                };
                                // Guardar en users para futuras referencias
                                users[seatInfo.userId] = winnerInfo;
                            }
                        } else {
                            const userData = await getUserByUsername(winnerUsername);
                            if (userData) {
                                winnerInfo = userData;
                                // Guardar en users para futuras referencias
                                users[seatInfo.userId] = winnerInfo;
                            }
                        }
                    } catch (error) {
                        console.error(`[${roomId}] Error obteniendo datos de usuario para pago:`, error);
                    }
                }

                if (winnerInfo) {
                    const winningsInUserCurrency = convertCurrency(winningsPerPlayer, roomCurrency, winnerInfo.currency, exchangeRates);
                    winnerInfo.credits += winningsInUserCurrency;
                    
                    // Actualizar en BD o inMemoryUsers
                    await updateUserCredits(seatInfo.userId, winnerInfo.credits, winnerInfo.currency);
                    
                    console.log(`[${roomId}] PAGO REALIZADO (Abandono Grupo): ${winnerUsername} recibe ${winningsPerPlayer.toFixed(2)} ${roomCurrency}`);
                    const winnerSocket = io.sockets.sockets.get(seatInfo.playerId);
                    if (winnerSocket) {
                        winnerSocket.emit('userStateUpdated', winnerInfo);
                    }
                    winningPlayersPayload.push({
                        playerId: seatInfo.playerId,
                        userId: seatInfo.userId,
                        playerName: seatInfo.playerName,
                        color: seatInfo.color,
                        winningsRoomCurrency: winningsPerPlayer,
                        winningsUserCurrency: winningsInUserCurrency,
                        userCurrency: winnerInfo.currency
                    });
                } else {
                    console.warn(`[${roomId}] PAGO FALLIDO (Abandono Grupo): No se encontró userInfo para ${winnerUsername} (ID: ${seatInfo.userId}).`);
                }
                // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
            }

            const playersWhoPlayed = room.gameState.playersAtStart || [];

            // 3. Usar los datos del HOST ÚNICO para 'rematchData'
            room.rematchData = {
                winnerId: rematchHostId,
                winnerName: rematchHostName,
                winnerColor: rematchHostColor,
                confirmedPlayers: [],
                canStart: false,
                expectedPlayers: playersWhoPlayed.length
            };

            // 4. Usar el NOMBRE DE VISUALIZACIÓN para 'ludoGameOver'
            io.to(roomId).emit('playSound', 'victory');
            io.to(roomId).emit('ludoGameOver', {
                winnerName: winnerDisplayName,
                winnerColor: rematchHostColor,
                winnerAvatar: rematchHostAvatar,
                playersWhoPlayed: playersWhoPlayed,
                totalPot: totalPot,
                commission: commission,
                finalWinnings: finalWinnings,
                winningPlayers: winningPlayersPayload,
                rematchData: room.rematchData, // Contiene el host único correcto
                abandonment: true
            });

            room.allowRematchConfirmation = true;

            if (room.gameState && room.gameState.pieces && room.gameState.pieces[playerColor]) {
                delete room.gameState.pieces[playerColor];
            }
            
            // ▼▼▼ FIX: Forzar actualización de estado para sacar al jugador que abandonó de la sala ▼▼▼
            const sanitizedRoom = ludoGetSanitizedRoomForClient(room);
            io.to(roomId).emit('ludoGameStateUpdated', {
                newGameState: room.gameState,
                seats: room.seats,
                moveInfo: { type: 'game_over_abandonment', leavingPlayer: playerName, winner: winnerDisplayName }
            });
            
            // Notificar específicamente al jugador que abandonó que debe salir
            const leavingPlayerSocket = io.sockets.sockets.get(leavingPlayerId);
            if (leavingPlayerSocket) {
                leavingPlayerSocket.emit('playerLeft', sanitizedRoom);
                leavingPlayerSocket.emit('gameEnded', { reason: 'abandonment', winner: winnerDisplayName });
                setTimeout(() => {
                    if (leavingPlayerSocket && leavingPlayerSocket.currentRoomId === roomId) {
                        leavingPlayerSocket.leave(roomId);
                        delete leavingPlayerSocket.currentRoomId;
                        console.log(`[${roomId}] Socket ${leavingPlayerId} forzado a salir de la sala después de abandono (Parchís Grupos)`);
                    }
                }, 1000);
            }
            // ▲▲▲ FIN DEL FIX ▲▲▲

            return; // Salir de la función handlePlayerDeparture
        }
        // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

        const username = leavingPlayerSeat.userId.replace('user_', '');
        let userInfo = users[leavingPlayerSeat.userId];
        const bet = parseFloat(room.settings.bet) || 0;
        const roomCurrencyForFault = room.settings.betCurrency || 'USD';
        
        // ▼▼▼ CRÍTICO: Aplicar penalización al jugador que abandona voluntariamente ▼▼▼
        // Obtener información del usuario si no está en users
        if (!userInfo && leavingPlayerSeat.userId) {
            try {
                if (DISABLE_DB) {
                    const userFromMemory = inMemoryUsers.get(username);
                    if (userFromMemory) {
                        userInfo = {
                            credits: parseFloat(userFromMemory.credits || 0),
                            currency: userFromMemory.currency || 'EUR'
                        };
                        users[leavingPlayerSeat.userId] = userInfo;
                    }
                } else {
                    const userData = await getUserByUsername(username);
                    if (userData) {
                        userInfo = userData;
                        users[leavingPlayerSeat.userId] = userInfo;
                    }
                }
            } catch (error) {
                console.error(`[${roomId}] Error obteniendo datos de usuario para penalización:`, error);
            }
        }
        
        // ▼▼▼ CRÍTICO: Verificar si ya fue penalizado para evitar cobrar dos veces ▼▼▼
        // Verificar tanto en la sala como en el sistema global (por si la sala fue eliminada)
        const globalPenaltyKey = `${roomId}_${leavingPlayerSeat.userId}`;
        const alreadyPenalized = ludoGlobalPenaltyApplied[globalPenaltyKey] || (room.penaltyApplied && room.penaltyApplied[leavingPlayerSeat.userId]);
        
        // Inicializar el objeto de penalizaciones si no existe
        if (!room.penaltyApplied) {
            room.penaltyApplied = {};
        }
        
        // ▼▼▼ CORRECCIÓN: NO DESCONTAR LA APUESTA AL ABANDONAR (YA SE DESCONTÓ AL INICIAR) ▼▼▼
        // La apuesta ya se descontó al iniciar la partida en ludoStartGame, por lo que NO se debe descontar de nuevo al abandonar
        // Solo notificar al jugador que abandonó (sin descontar créditos)
            if (userInfo) {
            // Notificar al jugador que abandonó de su saldo actual (sin cambios)
                let leavingPlayerSocket = io.sockets.sockets.get(leavingPlayerId);
                if (!leavingPlayerSocket && leavingPlayerSeat.userId) {
                    for (const [socketId, socket] of io.sockets.sockets.entries()) {
                        const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                        if (socketUserId === leavingPlayerSeat.userId) {
                            leavingPlayerSocket = socket;
                            break;
                        }
                    }
                }
                if (leavingPlayerSocket) {
                    leavingPlayerSocket.emit('userStateUpdated', userInfo);
                console.log(`[${roomId}] userStateUpdated enviado al jugador que abandonó ${username} (credits: ${userInfo.credits} ${userInfo.currency}) - SIN DESCONTAR APUESTA (ya se descontó al iniciar)`);
                }
            } else {
            console.warn(`[${roomId}] No se encontró userInfo para ${username} (ID: ${leavingPlayerSeat.userId}).`);
            }
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
        
        // Emitir notificación de falta por abandono
        io.to(roomId).emit('playSound', 'fault');
        io.to(roomId).emit('ludoFoulPenalty', { type: 'abandon', playerName: playerName });
        
        if (room.gameState && room.gameState.pieces && room.gameState.pieces[playerColor]) {
            delete room.gameState.pieces[playerColor];
            console.log(`[${roomId}] Fichas de ${playerColor} eliminadas del estado.`);
        }
        
        const remainingActivePlayers = room.seats.filter(s => s !== null && s.status === 'playing');
        console.log(`[${roomId}] Jugadores activos restantes: ${remainingActivePlayers.length}`);

        if (remainingActivePlayers.length === 1) {
            const winnerSeat = remainingActivePlayers[0];
            const winnerName = winnerSeat.playerName;
            console.log(`[${roomId}] ¡¡¡VICTORIA POR ABANDONO!!! Solo queda 1 jugador: ${winnerName}`);
            room.state = 'post-game';
            const totalPot = room.gameState.pot;
            const commission = totalPot * 0.10;
            const finalWinnings = totalPot - commission;

            // Guardar comisión en el log de administración (solo una vez por partida)
            const roomCurrency = room.settings.betCurrency || 'USD';
            if (!room.commissionSaved) {
                const commissionInCOP = convertCurrency(commission, roomCurrency, 'COP', exchangeRates);
                await saveCommission(commissionInCOP, 'COP');
                room.commissionSaved = true; // Marcar que ya se guardó la comisión
            }

            // --- INICIO: PAGO DE PREMIOS (Añadido) ---
            // ▼▼▼ CORRECCIÓN CRÍTICA: Obtener userInfo desde users, BD o inMemoryUsers ▼▼▼
            const winnerUsername = winnerSeat.userId.replace('user_', '');
            let winnerInfo = users[winnerSeat.userId];
            
            // Si no está en users, intentar obtenerlo de la BD o inMemoryUsers
            if (!winnerInfo) {
                try {
                    if (DISABLE_DB) {
                        const userFromMemory = inMemoryUsers.get(winnerUsername);
                        if (userFromMemory) {
                            winnerInfo = {
                                credits: parseFloat(userFromMemory.credits || 0),
                                currency: userFromMemory.currency || 'EUR'
                            };
                            // Guardar en users para futuras referencias
                            users[winnerSeat.userId] = winnerInfo;
                        }
                    } else {
                        const userData = await getUserByUsername(winnerUsername);
                        if (userData) {
                            winnerInfo = userData;
                            // Guardar en users para futuras referencias
                            users[winnerSeat.userId] = winnerInfo;
                        }
                    }
                } catch (error) {
                    console.error(`[${roomId}] Error obteniendo datos de usuario para pago:`, error);
                }
            }

            if (winnerInfo) {
                // Convertir la ganancia (en moneda de la sala) a la moneda del usuario
                const winningsInUserCurrency = convertCurrency(finalWinnings, roomCurrency, winnerInfo.currency, exchangeRates);
                
                // Sumar los créditos
                winnerInfo.credits += winningsInUserCurrency;
                
                // Actualizar en BD o inMemoryUsers
                await updateUserCredits(winnerSeat.userId, winnerInfo.credits, winnerInfo.currency);
                
                console.log(`[${roomId}] PAGO REALIZADO (Abandono): ${winnerUsername} (Ganador) recibe ${finalWinnings.toFixed(2)} ${roomCurrency} (Equivalente a ${winningsInUserCurrency.toFixed(2)} ${winnerInfo.currency}).`);
                console.log(`[${roomId}] Saldo anterior: ${(winnerInfo.credits - winningsInUserCurrency).toFixed(2)} ${winnerInfo.currency}. Saldo nuevo: ${winnerInfo.credits.toFixed(2)} ${winnerInfo.currency}.`);

                // Notificar al ganador (si está conectado) de su nuevo saldo
                // Buscar el socket por playerId primero, luego por userId si no se encuentra
                let winnerSocket = io.sockets.sockets.get(winnerSeat.playerId);
                
                // Si no encontramos el socket por playerId, buscar por userId
                if (!winnerSocket && winnerSeat.userId) {
                    for (const [socketId, socket] of io.sockets.sockets.entries()) {
                        const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                        if (socketUserId === winnerSeat.userId) {
                            winnerSocket = socket;
                            break;
                        }
                    }
                }
                
                if (winnerSocket) {
                    winnerSocket.emit('userStateUpdated', winnerInfo);
                    console.log(`[${roomId}] userStateUpdated enviado al ganador ${winnerUsername} (credits: ${winnerInfo.credits} ${winnerInfo.currency})`);
                } else {
                    console.warn(`[${roomId}] No se encontró socket para notificar al ganador ${winnerUsername}. Puede que se haya desconectado.`);
                }
            } else {
                console.warn(`[${roomId}] PAGO FALLIDO (Abandono): No se encontró userInfo para ${winnerUsername} (ID: ${winnerSeat.userId}).`);
            }
            // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
            // --- FIN: PAGO DE PREMIOS ---
            const playersWhoPlayed = room.gameState.playersAtStart || [winnerSeat.playerName, playerName];
            room.rematchData = {
                winnerId: winnerSeat.playerId,
                winnerName: winnerName,
                winnerColor: winnerSeat.color,
                confirmedPlayers: [],
                canStart: false,
                expectedPlayers: 1
            };
            io.to(roomId).emit('playSound', 'victory');
            io.to(roomId).emit('ludoGameOver', {
                winnerName: winnerName,
                winnerColor: winnerSeat.color,
                winnerAvatar: winnerSeat.avatar,
                playersWhoPlayed: playersWhoPlayed,
                totalPot: totalPot,
                commission: commission,
                finalWinnings: finalWinnings,
                rematchData: room.rematchData,
                abandonment: true
            });
            room.allowRematchConfirmation = true;
            
            // ▼▼▼ FIX CRÍTICO: Marcar abandono como finalizado ANTES de liberar asiento y notificar ▼▼▼
            // Marcar que el abandono fue definitivo para este jugador
            if (!room.abandonmentFinalized) {
                room.abandonmentFinalized = {};
            }
            room.abandonmentFinalized[leavingPlayerSeat.userId] = {
                reason: 'Abandono por inactividad',
                penaltyApplied: true,
                timestamp: Date.now()
            };
            console.log(`[${roomId}] ✅ Jugador ${playerName} registrado en abandonmentFinalized para mostrar modal si regresa.`);
            
            // Cancelar cualquier timeout de reconexión pendiente
            const timeoutKey = `${roomId}_${leavingPlayerSeat.userId}`;
            if (ludoReconnectTimeouts[timeoutKey]) {
                clearTimeout(ludoReconnectTimeouts[timeoutKey]);
                delete ludoReconnectTimeouts[timeoutKey];
            }
            if (room.abandonmentTimeouts && room.abandonmentTimeouts[leavingPlayerSeat.userId]) {
                clearTimeout(room.abandonmentTimeouts[leavingPlayerSeat.userId]);
                delete room.abandonmentTimeouts[leavingPlayerSeat.userId];
            }
            
            // Limpiar reconnectSeats para este jugador
            if (room.reconnectSeats && room.reconnectSeats[leavingPlayerSeat.userId]) {
                delete room.reconnectSeats[leavingPlayerSeat.userId];
                if (Object.keys(room.reconnectSeats).length === 0) {
                    delete room.reconnectSeats;
                }
            }
            
            // Emitir actualización de estado que sincronice a todos los jugadores
            const sanitizedRoom = ludoGetSanitizedRoomForClient(room);
            io.to(roomId).emit('ludoGameStateUpdated', {
                newGameState: room.gameState,
                seats: room.seats,
                moveInfo: { type: 'game_over_abandonment', leavingPlayer: playerName, winner: winnerName }
            });
            
            // Notificar específicamente al jugador que abandonó que debe salir
            // Buscar el socket por userId en caso de que se haya reconectado con nuevo socket.id
            let leavingPlayerSocket = io.sockets.sockets.get(leavingPlayerId);
            
            // Si no encontramos el socket por playerId, buscar por userId en todos los sockets conectados
            if (!leavingPlayerSocket && leavingPlayerSeat.userId) {
                for (const [socketId, socket] of io.sockets.sockets.entries()) {
                    const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                    if (socketUserId === leavingPlayerSeat.userId) {
                        leavingPlayerSocket = socket;
                        break;
                    }
                }
            }
            
            // roomCurrency ya está declarado al inicio de la función
            const bet = parseFloat(room.settings.bet) || 0;
            
            if (leavingPlayerSocket) {
                // ▼▼▼ CRÍTICO: Enviar userStateUpdated ANTES de gameEnded para preservar sesión ▼▼▼
                // Obtener información del usuario eliminado para enviar su estado actualizado
                const leavingPlayerUsername = leavingPlayerSeat.userId.replace('user_', '');
                let leavingPlayerInfo = users[leavingPlayerSeat.userId];
                
                // Si no está en users, intentar obtenerlo de la BD o inMemoryUsers
                if (!leavingPlayerInfo) {
                    try {
                        if (DISABLE_DB) {
                            const userFromMemory = inMemoryUsers.get(leavingPlayerUsername);
                            if (userFromMemory) {
                                leavingPlayerInfo = {
                                    credits: parseFloat(userFromMemory.credits || 0),
                                    currency: userFromMemory.currency || 'EUR',
                                    username: leavingPlayerUsername,
                                    avatar: leavingPlayerSeat.avatar || ''
                                };
                                users[leavingPlayerSeat.userId] = leavingPlayerInfo;
                            }
                        } else {
                            const userData = await getUserByUsername(leavingPlayerUsername);
                            if (userData) {
                                leavingPlayerInfo = {
                                    ...userData,
                                    username: leavingPlayerUsername,
                                    avatar: leavingPlayerSeat.avatar || userData.avatar || ''
                                };
                                users[leavingPlayerSeat.userId] = leavingPlayerInfo;
                            }
                        }
                    } catch (error) {
                        console.error(`[${roomId}] Error obteniendo datos de usuario eliminado:`, error);
                    }
                } else {
                    // Asegurar que tenga username y avatar
                    leavingPlayerInfo.username = leavingPlayerUsername;
                    leavingPlayerInfo.avatar = leavingPlayerSeat.avatar || leavingPlayerInfo.avatar || '';
                }
                
                // Enviar userStateUpdated ANTES de gameEnded para que el cliente preserve la sesión
                if (leavingPlayerInfo) {
                    leavingPlayerSocket.emit('userStateUpdated', leavingPlayerInfo);
                    console.log(`[${roomId}] userStateUpdated enviado al jugador eliminado ${leavingPlayerUsername} (credits: ${leavingPlayerInfo.credits} ${leavingPlayerInfo.currency})`);
                }
                // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
                
                leavingPlayerSocket.emit('playerLeft', sanitizedRoom);
                leavingPlayerSocket.emit('gameEnded', { 
                    reason: 'abandonment', 
                    winner: winnerName,
                    message: `Has sido eliminado por abandono. La apuesta ya fue descontada al iniciar la partida.`,
                    redirect: true, // CRÍTICO: Forzar redirección al lobby
                    forceExit: true, // Flag extra para forzar salida
                    penalty: 0,
                    currency: roomCurrency,
                    // Incluir datos del usuario para preservar sesión
                    username: leavingPlayerUsername,
                    userId: leavingPlayerSeat.userId,
                    avatar: leavingPlayerSeat.avatar || '',
                    userCurrency: leavingPlayerInfo?.currency || 'EUR'
                });
                // Forzar que el socket salga de la sala inmediatamente
                if (leavingPlayerSocket.currentRoomId === roomId) {
                    leavingPlayerSocket.leave(roomId);
                    delete leavingPlayerSocket.currentRoomId;
                    console.log(`[${roomId}] Socket ${leavingPlayerId} forzado a salir de la sala después de abandono`);
                }
            }
            
            // IMPORTANTE: Marcar la sala para que no se limpie inmediatamente después del abandono
            // Esto permite que el jugador que abandonó pueda recibir la notificación si se reconecta
            room._abandonmentProcessed = true;
            room._abandonmentTimestamp = Date.now();
            
            console.log(`[${roomId}] Abandono procesado para ${playerName} (${leavingPlayerSeat.userId}). Sala marcada para limpieza diferida.`);
            // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲ 
        } else if (remainingActivePlayers.length > 1) {
            io.to(roomId).emit('ludoGameStateUpdated', {
                newGameState: room.gameState, 
                seats: room.seats,            
                moveInfo: { type: 'player_left', playerColor: playerColor } 
            });
            if (room.gameState && room.gameState.turn.playerIndex === seatIndex) {
                console.log(`[${roomId}] Era el turno del jugador que abandonó. Pasando al siguiente INMEDIATAMENTE...`);
                ludoPassTurn(room, io);
            }
            
            // ▼▼▼ CRÍTICO: Si es por inactividad, expulsar automáticamente al lobby con modal específico ▼▼▼
            if (isInactivityTimeout) {
                // Buscar el socket del jugador eliminado
                let leavingPlayerSocket = io.sockets.sockets.get(leavingPlayerId);
                if (!leavingPlayerSocket && leavingPlayerSeat.userId) {
                    for (const [socketId, socket] of io.sockets.sockets.entries()) {
                        const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                        if (socketUserId === leavingPlayerSeat.userId) {
                            leavingPlayerSocket = socket;
                            break;
                        }
                    }
                }
                
                if (leavingPlayerSocket) {
                    // Obtener información del usuario
                    const leavingPlayerUsername = leavingPlayerSeat.userId.replace('user_', '');
                    let leavingPlayerInfo = users[leavingPlayerSeat.userId];
                    
                    if (!leavingPlayerInfo) {
                        try {
                            if (DISABLE_DB) {
                                const userFromMemory = inMemoryUsers.get(leavingPlayerUsername);
                                if (userFromMemory) {
                                    leavingPlayerInfo = {
                                        credits: parseFloat(userFromMemory.credits || 0),
                                        currency: userFromMemory.currency || 'EUR',
                                        username: leavingPlayerUsername,
                                        avatar: leavingPlayerSeat.avatar || ''
                                    };
                                    users[leavingPlayerSeat.userId] = leavingPlayerInfo;
                                }
                            } else {
                                const userData = await getUserByUsername(leavingPlayerUsername);
                                if (userData) {
                                    leavingPlayerInfo = {
                                        ...userData,
                                        username: leavingPlayerUsername,
                                        avatar: leavingPlayerSeat.avatar || userData.avatar || ''
                                    };
                                    users[leavingPlayerSeat.userId] = leavingPlayerInfo;
                                }
                            }
                        } catch (error) {
                            console.error(`[${roomId}] Error obteniendo datos de usuario eliminado por inactividad:`, error);
                        }
                    } else {
                        leavingPlayerInfo.username = leavingPlayerUsername;
                        leavingPlayerInfo.avatar = leavingPlayerSeat.avatar || leavingPlayerInfo.avatar || '';
                    }
                    
                    // Enviar userStateUpdated antes de expulsar
                    if (leavingPlayerInfo) {
                        leavingPlayerSocket.emit('userStateUpdated', leavingPlayerInfo);
                    }
                    
                    // Forzar salida del socket de la sala
                    if (leavingPlayerSocket.currentRoomId === roomId) {
                        leavingPlayerSocket.leave(roomId);
                        delete leavingPlayerSocket.currentRoomId;
                        console.log(`[${roomId}] Socket ${leavingPlayerId} forzado a salir de la sala después de eliminación por inactividad`);
                    }
                    
                    // Enviar evento específico para inactividad que redirige al lobby y muestra modal
                    leavingPlayerSocket.emit('inactivityTimeout', {
                        message: 'Has sido eliminado de la mesa por falta de inactividad por 2 minutos.',
                        redirect: true,
                        forceExit: true,
                        reason: 'inactivity',
                        username: leavingPlayerUsername,
                        userId: leavingPlayerSeat.userId,
                        avatar: leavingPlayerSeat.avatar || '',
                        userCurrency: leavingPlayerInfo?.currency || 'EUR'
                    });
                    
                    console.log(`[${roomId}] Jugador ${leavingPlayerUsername} expulsado al lobby por inactividad. Modal de inactividad enviado.`);
                }
            }
            // ▲▲▲ FIN EXPULSIÓN POR INACTIVIDAD ▲▲▲
        } else {
            console.log(`[${roomId}] No quedan jugadores activos después del abandono.`);
        }
        
    } else if (leavingPlayerSeat.status === 'waiting') {
        console.log(`Jugador ${playerName} ha salido mientras esperaba (estado: ${room.state}).`);
        io.to(roomId).emit('playerAbandoned', {
            message: `${playerName} ha abandonado la mesa.`
        });

        console.log(`[${roomId}] Sincronizando asientos tras abandono en espera.`);
        // Emitir actualización inmediata a todos en la sala
        io.to(roomId).emit('playerJoined', ludoGetSanitizedRoomForClient(room));
        
        // También emitir actualización global de la lista de salas
        broadcastLudoRoomListUpdate(io);
    }
    
    ludoHandleHostLeaving(room, leavingPlayerId, io);
    // REEMPLAZO: Llamamos a checkAndCleanRoom en lugar de solo transmitir.
    // checkAndCleanRoom se encargará de eliminar la sala si está vacía Y de transmitir la lista actualizada.
    ludoCheckAndCleanRoom(roomId, io);
    
    // Asegurar actualización en tiempo real de la lista de salas después de cualquier abandono
    broadcastLudoRoomListUpdate(io);
}

// === boardJumps ===
const ludoBoardJumps = {
    7: 8,   // Puente Amarillo (Entrada)
    9: 10,  // Puente Amarillo (Salida)
    24: 25, // Puente Azul (Entrada)
    26: 27, // Puente Azul (Salida)
    41: 42, // Puente Rojo (Entrada)
    43: 44, // Puente Rojo (Salida)
    58: 59, // Puente Verde (Entrada)
    60: 61  // Puente Verde (Salida)
}

// === areAllPiecesInGoal ===
function ludoAreAllPiecesInGoal(room, color) {
    if (!room || !room.gameState || !room.gameState.pieces || !room.gameState.board) return false;
    const pieces = room.gameState.pieces[color];
    const goalCell = room.gameState.board.goal?.[color];
    if (!pieces || goalCell === undefined) return false;
    if (pieces.length === 0) return false;
    return pieces.every(piece => piece.state === 'active' && piece.position === goalCell);
}

// === getControlledColorForSeat ===
function ludoGetControlledColorForSeat(room, seatIndex) {
    const seat = room?.seats?.[seatIndex];
    if (!seat) return null;
    let color = seat.color;
    if (room?.settings?.gameType === 'parchis' && room?.settings?.parchisMode === '4-groups' && room.gameState) {
        const playerPieces = room.gameState.pieces?.[color];
        const goalCell = room.gameState.board?.goal?.[color];
        if (playerPieces && goalCell !== undefined) {
            const allHome = playerPieces.length > 0 && playerPieces.every(piece => piece.state === 'active' && piece.position === goalCell);
            if (allHome) {
                const partnerSeatIndex = (seatIndex + 2) % 4;
                const partnerSeat = room.seats?.[partnerSeatIndex];
                if (partnerSeat && partnerSeat.status !== 'waiting') {
                    const partnerColor = partnerSeat.color;
                    const partnerPieces = room.gameState.pieces?.[partnerColor];
                    const partnerGoalCell = room.gameState.board?.goal?.[partnerColor];
                    if (partnerPieces && partnerGoalCell !== undefined) {
                        const partnerAllHome = partnerPieces.length > 0 && partnerPieces.every(piece => piece.state === 'active' && piece.position === partnerGoalCell);
                        if (!partnerAllHome) {
                            color = partnerColor;
                        }
                    }
                }
            }
        }
    }
    return color;
}

// === passTurn ===
function ludoPassTurn(room, io, isPunishmentTurn = false) {
    if (!room || room.state !== 'playing' || !room.gameState || !room.gameState.turn) {
        return;
    }

    const roomId = room.roomId;
    const currentTurnIndex = room.gameState.turn.playerIndex;
    const seats = room.seats;
    const activePlayers = seats.filter(s => s && s.status !== 'waiting');

    if (activePlayers.length < 2) {
        console.log(`[${roomId}] No se puede pasar el turno, solo hay ${activePlayers.length} jugador(es) activos.`);
        return;
    }

    const TURN_ORDER = ['yellow', 'blue', 'red', 'green'];

    const currentSeat = seats[currentTurnIndex];
    const fallbackColor = room.settings?.colorMap ? room.settings.colorMap[currentTurnIndex] : null;
    const currentColor = currentSeat?.color || fallbackColor;


    let currentTurnOrderIndex = currentColor ? TURN_ORDER.indexOf(currentColor) : -1;
    if (currentTurnOrderIndex === -1) {
        currentTurnOrderIndex = currentTurnIndex % TURN_ORDER.length;
    }

    let nextPlayerIndex = -1;
    let nextPlayer = null;

    for (let i = 1; i <= 4; i++) {
        const nextTurnOrderIndex = (currentTurnOrderIndex + i) % 4;
        const nextColor = TURN_ORDER[nextTurnOrderIndex];
        const foundSeatIndex = seats.findIndex(s => s && s.color === nextColor && s.status !== 'waiting');

        if (foundSeatIndex !== -1) {
            const candidateSeat = seats[foundSeatIndex];
            // ▼▼▼ CRÍTICO: Verificar que el jugador NO esté eliminado antes de asignarlo como siguiente jugador ▼▼▼
            if (candidateSeat && candidateSeat.userId) {
                const candidatePenaltyKey = `${roomId}_${candidateSeat.userId}`;
                const isEliminated = ludoGlobalPenaltyApplied[candidatePenaltyKey] || 
                                    (room.penaltyApplied && room.penaltyApplied[candidateSeat.userId]) ||
                                    (room.abandonmentFinalized && room.abandonmentFinalized[candidateSeat.userId]);
                
                if (isEliminated) {
                    console.log(`[${roomId}] ⚠️ Jugador ${candidateSeat.playerName} (asiento ${foundSeatIndex}) está eliminado. Buscando siguiente jugador...`);
                    continue; // Saltar este jugador y buscar el siguiente
                }
            }
            // ▲▲▲ FIN VERIFICACIÓN DE ELIMINACIÓN ▲▲▲
            
            nextPlayerIndex = foundSeatIndex;
            nextPlayer = candidateSeat;
            break;
        }
    }

    if (nextPlayerIndex === -1 || !nextPlayer) {
            console.warn(`[${roomId}] No se pudo encontrar un siguiente jugador activo.`);
        return;
    }

    room.gameState.turn.playerIndex = nextPlayerIndex;
    room.gameState.turn.canRoll = true;
    room.gameState.turn.canRollAgain = false;
    room.gameState.turn.dice = [0, 0];
    room.gameState.turn.moves = [];
    room.gameState.turn.possibleMoves = [];
    room.gameState.turn.doublesCount = 0;
    room.gameState.turn.isMoving = false;

    if (!isPunishmentTurn) {
        room.gameState.turn.lastMovedPieceId = null;
    } else {
        console.log(`[${roomId}] Turno de castigo. Se conserva lastMovedPieceId (${room.gameState.turn.lastMovedPieceId}) para volver a usarlo.`);
    }

    console.log(`[${roomId}] Turno pasado de ${currentColor ?? 'desconocido'} (Asiento ${currentTurnIndex}) a ${nextPlayer.color} (Asiento ${nextPlayerIndex})`);

    // ▼▼▼ TIMEOUT DE INACTIVIDAD: Iniciar timeout de 2 minutos para el nuevo jugador ▼▼▼
    // Cancelar timeout anterior si existe
    const previousTimeoutKey = `${roomId}_${currentSeat?.playerId}`;
    if (ludoInactivityTimeouts[previousTimeoutKey]) {
        clearTimeout(ludoInactivityTimeouts[previousTimeoutKey]);
        delete ludoInactivityTimeouts[previousTimeoutKey];
        console.log(`[${roomId}] Timeout de inactividad cancelado para el jugador anterior (asiento ${currentTurnIndex})`);
    }
    
    // Verificar si el nuevo jugador está desconectado
    const nextPlayerDisconnectKey = `${roomId}_${nextPlayer.userId}`;
    const isDisconnected = ludoDisconnectedPlayers[nextPlayerDisconnectKey];
    
    // ▼▼▼ CRÍTICO: Verificar si el jugador ya fue eliminado antes de iniciar timeout ▼▼▼
    // Si el jugador ya fue penalizado, significa que ya fue eliminado, no iniciar timeout
    const globalPenaltyKey = `${roomId}_${nextPlayer.userId}`;
    const alreadyPenalized = ludoGlobalPenaltyApplied[globalPenaltyKey] || (room.penaltyApplied && room.penaltyApplied[nextPlayer.userId]);
    
    if (alreadyPenalized) {
        console.log(`[${roomId}] ⚠️ El jugador ${nextPlayer.playerName} ya fue eliminado y penalizado. NO se inicia timeout de inactividad.`);
        // No iniciar timeout si ya fue eliminado
        // Continuar con el flujo normal del turno
    } else if (isDisconnected) {
        console.log(`[${roomId}] ⚠️ El jugador ${nextPlayer.playerName} está desconectado y le toca el turno. Iniciando timeout de inactividad de 2 minutos.`);
    }
    // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    
    // Iniciar timeout de inactividad para el nuevo jugador SOLO si NO fue eliminado
    // ▼▼▼ CRÍTICO: Usar userId en lugar de playerId para consistencia y cancelar TODOS los timeouts posibles ▼▼▼
    const newTimeoutKey = `${roomId}_${nextPlayer.userId}`;
    
    // Cancelar TODOS los timeouts posibles antes de iniciar uno nuevo (para asegurar que siempre se espere 2 minutos completos)
    if (ludoInactivityTimeouts[newTimeoutKey]) {
        clearTimeout(ludoInactivityTimeouts[newTimeoutKey]);
        delete ludoInactivityTimeouts[newTimeoutKey];
        console.log(`[${roomId}] Timeout anterior cancelado para ${nextPlayer.playerName} (userId: ${nextPlayer.userId})`);
    }
    const newTimeoutKeyByPlayerId = `${roomId}_${nextPlayer.playerId}`;
    if (ludoInactivityTimeouts[newTimeoutKeyByPlayerId]) {
        clearTimeout(ludoInactivityTimeouts[newTimeoutKeyByPlayerId]);
        delete ludoInactivityTimeouts[newTimeoutKeyByPlayerId];
        console.log(`[${roomId}] Timeout anterior cancelado para ${nextPlayer.playerName} (playerId: ${nextPlayer.playerId})`);
    }
    // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
    Object.keys(ludoInactivityTimeouts).forEach(key => {
        if (key.startsWith(`${roomId}_`) && (key.includes(nextPlayer.userId) || key.includes(nextPlayer.playerId))) {
            clearTimeout(ludoInactivityTimeouts[key]);
            delete ludoInactivityTimeouts[key];
            console.log(`[${roomId}] Timeout adicional cancelado: ${key}`);
        }
    });
    // ▲▲▲ FIN CANCELACIÓN DE TODOS LOS TIMEOUTS ▲▲▲
    
    // Solo iniciar timeout si el jugador NO fue eliminado
    if (!alreadyPenalized) {
        ludoInactivityTimeouts[newTimeoutKey] = setTimeout(() => {
        console.log(`[${roomId}] ⏰ TIMEOUT DE INACTIVIDAD: El jugador ${nextPlayer.playerName} (asiento ${nextPlayerIndex}) no hizo nada en 2 minutos. Eliminando por falta.`);
        
        // Verificar que el turno todavía es de este jugador
        const currentRoom = ludoRooms[roomId];
        if (!currentRoom || !currentRoom.gameState || !currentRoom.gameState.turn) {
            delete ludoInactivityTimeouts[newTimeoutKey];
            return;
        }
        
        const currentTurnPlayerIndex = currentRoom.gameState.turn.playerIndex;
        if (currentTurnPlayerIndex !== nextPlayerIndex) {
            console.log(`[${roomId}] El turno ya cambió. No se elimina al jugador por inactividad.`);
            delete ludoInactivityTimeouts[newTimeoutKey];
            return;
        }
        
        // Verificar que el jugador todavía está en la sala (usar userId en lugar de playerId porque puede estar desconectado)
        const currentSeat = currentRoom.seats[nextPlayerIndex];
        if (!currentSeat) {
            console.log(`[${roomId}] El asiento ${nextPlayerIndex} ya está vacío. No se elimina por inactividad.`);
            delete ludoInactivityTimeouts[newTimeoutKey];
            return;
        }
        
        // Verificar que es el mismo jugador por userId (no por playerId, porque puede estar desconectado)
        if (!currentSeat.userId || currentSeat.userId !== nextPlayer.userId) {
            console.log(`[${roomId}] El jugador en el asiento ${nextPlayerIndex} ya no es el mismo. No se elimina por inactividad.`);
            delete ludoInactivityTimeouts[newTimeoutKey];
            return;
        }
        
        // ▼▼▼ CRÍTICO: REGISTRAR EN abandonmentFinalized Y PENALIZACIÓN GLOBAL ANTES DE ELIMINAR ▼▼▼
        // Esto permite que si el jugador regresa, se le muestre el modal
        if (!currentRoom.abandonmentFinalized) {
            currentRoom.abandonmentFinalized = {};
        }
        currentRoom.abandonmentFinalized[currentSeat.userId] = {
            reason: 'Abandono por inactividad',
            penaltyApplied: true,
            timestamp: Date.now()
        };
        console.log(`[${roomId}] ✅ Jugador ${currentSeat.playerName} registrado en abandonmentFinalized para mostrar modal si regresa.`);
        
        // ▼▼▼ CRÍTICO: REGISTRAR PENALIZACIÓN GLOBAL ANTES DE ELIMINAR PARA EVITAR QUE SE REACTIVE EL TIMEOUT ▼▼▼
        const globalPenaltyKeyForElimination = `${roomId}_${currentSeat.userId}`;
        ludoGlobalPenaltyApplied[globalPenaltyKeyForElimination] = true;
        if (!currentRoom.penaltyApplied) {
            currentRoom.penaltyApplied = {};
        }
        currentRoom.penaltyApplied[currentSeat.userId] = true;
        console.log(`[${roomId}] ✅ Jugador ${currentSeat.playerName} registrado en ludoGlobalPenaltyApplied para evitar que se reactive el timeout.`);
        // ▲▲▲ FIN DE REGISTRO DE PENALIZACIÓN GLOBAL ▲▲▲
        // ▲▲▲ FIN DE REGISTRO ▲▲▲
        
        // Eliminar al jugador por inactividad - usar el playerId actual del asiento (puede ser null si está desconectado, pero ludoHandlePlayerDeparture lo manejará)
        console.log(`[${roomId}] 🚨 ELIMINANDO JUGADOR POR INACTIVIDAD: ${currentSeat.playerName} (asiento ${nextPlayerIndex}, userId: ${currentSeat.userId})`);
        
        // Buscar el playerId actual del asiento, o usar cualquier socket del userId si está desconectado
        let playerIdToUse = currentSeat.playerId;
        if (!playerIdToUse && currentSeat.userId) {
            // Si no hay playerId (jugador desconectado), buscar cualquier socket del userId
            for (const [socketId, socket] of io.sockets.sockets.entries()) {
                const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                if (socketUserId === currentSeat.userId) {
                    playerIdToUse = socketId;
                    break;
                }
            }
        }
        
        // Si encontramos un playerId, usarlo; si no, buscar el asiento por userId en ludoHandlePlayerDeparture
        if (playerIdToUse) {
            ludoHandlePlayerDeparture(roomId, playerIdToUse, io, false, true); // true = isInactivityTimeout
        } else {
            // Si no hay playerId, buscar el asiento por userId directamente
            const seatIndexByUserId = currentRoom.seats.findIndex(s => s && s.userId === currentSeat.userId);
            if (seatIndexByUserId !== -1) {
                // Usar el playerId del asiento encontrado, o un valor dummy que ludoHandlePlayerDeparture manejará
                const seatToEliminate = currentRoom.seats[seatIndexByUserId];
                if (seatToEliminate && seatToEliminate.playerId) {
                    ludoHandlePlayerDeparture(roomId, seatToEliminate.playerId, io, false, true);
                } else {
                    // Si no hay playerId, eliminar directamente el asiento
                    console.log(`[${roomId}] ⚠️ Jugador ${currentSeat.playerName} está desconectado sin socket. Eliminando asiento directamente.`);
                    currentRoom.seats[seatIndexByUserId] = null;
                    // Pasar el turno si era su turno
                    if (currentRoom.gameState && currentRoom.gameState.turn && currentRoom.gameState.turn.playerIndex === seatIndexByUserId) {
                        ludoPassTurn(currentRoom, io);
                    }
                }
            }
        }
        
        // Limpiar el timeout y el estado de desconexión
        delete ludoInactivityTimeouts[newTimeoutKey];
        // También limpiar por playerId por si acaso
        const timeoutKeyByPlayerId = `${roomId}_${nextPlayer.playerId}`;
        if (ludoInactivityTimeouts[timeoutKeyByPlayerId]) {
            delete ludoInactivityTimeouts[timeoutKeyByPlayerId];
        }
        delete ludoDisconnectedPlayers[nextPlayerDisconnectKey];
    }, LUDO_INACTIVITY_TIMEOUT_MS);
    
    if (isDisconnected && !alreadyPenalized) {
        console.log(`[${roomId}] ⏰ Timeout de inactividad iniciado para ${nextPlayer.playerName} (DESCONECTADO, asiento ${nextPlayerIndex}). Si no vuelve y actúa en ${LUDO_INACTIVITY_TIMEOUT_MS/1000} segundos, será eliminado.`);
    } else if (!alreadyPenalized) {
        console.log(`[${roomId}] ⏰ Timeout de inactividad iniciado para ${nextPlayer.playerName} (asiento ${nextPlayerIndex}). Si no actúa en ${LUDO_INACTIVITY_TIMEOUT_MS/1000} segundos, será eliminado.`);
    }
    // ▲▲▲ FIN TIMEOUT DE INACTIVIDAD ▲▲▲

    io.to(room.roomId).emit('ludoTurnChanged', {
        nextPlayerIndex,
        nextPlayerId: nextPlayer.playerId,
        nextPlayerName: nextPlayer.playerName,
        newGameState: room.gameState
    });
}
}

// === handleParchisRoll ===
async function ludoHandleParchisRoll(room, io, socket, dice1, dice2) {
    if (!room || room.state !== 'playing' || !room.gameState || !room.gameState.turn) {
        return;
    }

    const mySeatIndex = room.seats.findIndex((s) => s && s.playerId === socket.id);
    if (mySeatIndex === -1) {
        return socket.emit('ludoError', { message: 'No estás sentado en esta mesa.' });
    }

    const seat = room.seats[mySeatIndex];
    const roomId = room.roomId;
    const seatColor = seat.color;
    const playerColor = ludoGetControlledColorForSeat(room, mySeatIndex) || seatColor;
    const playerName = seat.playerName || 'Jugador';
    const turnData = room.gameState.turn;
    turnData.lastBreakdownStartPos = null;
    turnData.isForcedBlockadeBreak = false;
    const isDouble = dice1 === dice2;

    console.log(`[Parchís Roll] ${playerName} (${playerColor}) lanzó: ${dice1}-${dice2}`);

    // --- 1. Lógica de 3 dobles seguidos (castigo) ---
    if (isDouble) {
        turnData.doublesCount = (turnData.doublesCount || 0) + 1;
        if (turnData.doublesCount === 3) {
            console.log(`[Parchís] ¡Tercer doble consecutivo! Evaluando castigo.`);
            
            // 1. OBTENER LA FICHA A PENALIZAR
            const pieceToJail = turnData.lastMovedPieceId;
            
            // 2. VERIFICAR SI LA FICHA ESTÁ EN LA ZONA DE META (home_stretch)
            let isPieceInHomeStretch = false;
            if (pieceToJail) {
                const piece = room.gameState.pieces[playerColor]?.find((p) => p.id === pieceToJail);
                const homeStretch = room.gameState.board.home_stretch[playerColor] || [];
                if (piece && homeStretch.includes(piece.position)) {
                    isPieceInHomeStretch = true;
                    console.log(`[Parchís] Castigo evitado: ${pieceToJail} está en la recta final.`);
                }
            }
            
            // 3. APLICAR CASTIGO SOLO SI LA FICHA NO ESTÁ EN LA ZONA DE META
            if (!isPieceInHomeStretch && pieceToJail) {
                const punishedPiece = room.gameState.pieces[playerColor]?.find((p) => p.id === pieceToJail);
                if (punishedPiece) {
                    // 3.1. ENVIAR FICHA A CASA
                    punishedPiece.state = 'base';
                    punishedPiece.position = -1;
                    console.log(`[Parchís] Ficha ${punishedPiece.id} castigada de vuelta a la base.`);

                    // 3.2. ENVIAR NOTIFICACIÓN AL CLIENTE
                    io.to(room.roomId).emit('playSound', 'fault');
                    io.to(room.roomId).emit('ludoFoulPenalty', {
                        type: 'three_doubles',
                        playerName: playerName,
                        penalizedPieceId: punishedPiece.id
                    });
                }
            }

            // 4. REINICIAR Y CAMBIAR TURNO
            turnData.canRoll = false;
            turnData.canRollAgain = false;
            turnData.doublesCount = 0;
            turnData.moves = [];
            turnData.possibleMoves = [];

            io.to(room.roomId).emit('ludoDiceRolled', {
                playerId: socket.id,
                playerName,
                diceValues: [dice1, dice2],
                isDouble: true,
                turnData
            });

            setTimeout(() => ludoPassTurn(room, io, true), 2200);
            return;
        }
    } else {
        turnData.doublesCount = 0;
    }

    const playerPieces = room.gameState.pieces[playerColor] || [];
    const startPos = room.gameState.board.start[playerColor];
    const piecesOnStart = playerPieces.filter((p) => p.state === 'active' && p.position === startPos).length;
    const piecesInBase = playerPieces.filter((p) => p.state === 'base');

    let diceUsedForExit = [];
    let piecesAvailableToExit = piecesInBase.length;
    let blockadeJustCreatedOnStart = false;

    if (piecesAvailableToExit > 0) {
        let availableSlots = Math.max(0, 2 - piecesOnStart);

        if (availableSlots > 0) {
            if (isDouble && dice1 === 5) {
                diceUsedForExit.push('die1');
                piecesAvailableToExit--;
                availableSlots--;

                if (availableSlots > 0 && piecesAvailableToExit > 0) {
                    diceUsedForExit.push('die2');
                    piecesAvailableToExit--;
                    availableSlots--;
                }
            }

            if (diceUsedForExit.length === 0) {
                if (dice1 === 5 && availableSlots > 0 && piecesAvailableToExit > 0) {
                    diceUsedForExit.push('die1');
                    piecesAvailableToExit--;
                    availableSlots--;
                }
                if (dice2 === 5 && availableSlots > 0 && piecesAvailableToExit > 0) {
                    diceUsedForExit.push('die2');
                    piecesAvailableToExit--;
                    availableSlots--;
                }
            }

            if (diceUsedForExit.length === 0 && dice1 + dice2 === 5 && availableSlots > 0 && piecesAvailableToExit > 0) {
                diceUsedForExit.push('sum');
                piecesAvailableToExit--;
                availableSlots--;
            }
        }
    }

    const piecesActivated = [];

    const activatePieceFromBase = () => {
        let killOccurred = false;
        let pieceActivated = false;
        const targetPiece = playerPieces.find((p) => p.state === 'base');
        if (!targetPiece) return { killOccurred: false, pieceActivated: false }; // No pieces in base

        // ▼▼▼ INICIO DE LA CORRECCIÓN "MÁX 2 POR CASILLA" ▼▼▼
        
        // 1. Contar TODAS las fichas (mías y oponentes) que YA están en la casilla de salida.
        let opponentPiecesOnStart = [];
        let myPiecesOnStart = [];
        let totalPiecesOnStart = 0;

        for (const c in room.gameState.pieces) {
            // Filtra solo piezas activas en la casilla de salida
            const pieces = (room.gameState.pieces[c] || []).filter(p => p.state === 'active' && p.position === startPos);
            
            if (c === playerColor) {
                myPiecesOnStart = pieces;
            } else {
                opponentPiecesOnStart.push(...pieces);
            }
            totalPiecesOnStart += pieces.length; // Suma el total
        }

        // Selecciona la primera ficha oponente que se encontraría (para la matanza)
        const opponentPieceToKill = opponentPiecesOnStart.length > 0 ? opponentPiecesOnStart[0] : null;
        
        // ▲▲▲ FIN DE LA CORRECCIÓN ▼▼▼

        // 3. Aplicar la lógica de "Máx 2 por casilla"
        if (totalPiecesOnStart < 2) {
            // Caso 1: Hay 0 o 1 ficha en la salida. Se puede salir.
            targetPiece.state = 'active';
            targetPiece.position = startPos;
            piecesActivated.push(targetPiece.id);
            pieceActivated = true;
            
        } else if (totalPiecesOnStart >= 2 && opponentPieceToKill) {
            // Caso 2: Hay 2 (o más) fichas Y al menos una es oponente.
            // Se mata a UN oponente y se ocupa su lugar. El total sigue siendo 2.
            console.log(`[Parchís Salida] ¡MATANZA! ${targetPiece.id} sale a ${startPos} y mata a ${opponentPieceToKill.id}.`);
            opponentPieceToKill.state = 'base';
            opponentPieceToKill.position = -1;
            killOccurred = true;
            targetPiece.state = 'active';
            targetPiece.position = startPos;
            piecesActivated.push(targetPiece.id);
            pieceActivated = true;

        } else {
            // Caso 3: Hay 2 fichas y AMBAS son mías (opponentPieceToKill es null).
            // O hay 2 fichas oponentes y 0 mías (opponentPieceToKill es true, pero el Caso 2 ya lo manejó).
            // O cualquier otra combinación que sume 2 sin oponentes (2 mías).
            console.warn(`[Parchís Salida] Bloqueo: ${targetPiece.id} intentó salir a ${startPos}, pero ya hay ${totalPiecesOnStart} fichas (probablemente mías).`);
            return { killOccurred: false, pieceActivated: false };
        }

        const piecesNowOnStart = playerPieces.filter((p) => p.state === 'active' && p.position === startPos).length;
        if (piecesNowOnStart === 2) {
            blockadeJustCreatedOnStart = true;
        }

        return { killOccurred, pieceActivated };
    };

    let killBonusPending = false;

    if (diceUsedForExit.includes('die1')) {
        const result = activatePieceFromBase();
        if (result.killOccurred) killBonusPending = true;
    }
    if (diceUsedForExit.includes('die2')) {
        const result = activatePieceFromBase();
        if (result.killOccurred) killBonusPending = true;
    }
    if (diceUsedForExit.includes('sum')) {
        const result = activatePieceFromBase();
        if (result.killOccurred) killBonusPending = true;
    }

    if (piecesActivated.length > 0) {
        // ▼▼▼ MODIFICACIÓN: AUMENTO DE RETRASO A 2.5 SEGUNDOS ▼▼▼
        // Secuencia: 1s Animación Cliente + 1.5s Pausa lectura = 2.5s Total
        console.log(`[Parchís Auto-Exit] Retrasando visualización de salida 2500ms.`);
        
        setTimeout(() => {
            try {
                const activeRoom = ludoRooms[roomId];
                if (activeRoom) {
                    io.to(activeRoom.roomId).emit('ludoGameStateUpdated', {
                        newGameState: activeRoom.gameState,
                        moveInfo: {
                            type: 'parchis_auto_exit',
                            playerColor,
                            piecesMoved: piecesActivated,
                            startPosition: startPos
                        }
                    });
                }
            } catch (e) {
                console.error("Error en Timeout Parchis Roll:", e);
            }
        }, 2500);
        // ▲▲▲ FIN MODIFICACIÓN ▲▲▲
    }

    let killBonusHandled = false;
    let remainingDice = [];
    if (!diceUsedForExit.includes('die1')) {
        remainingDice.push(dice1);
    }
    if (!diceUsedForExit.includes('die2')) {
        remainingDice.push(dice2);
    }

    if (diceUsedForExit.includes('sum')) {
        remainingDice = [];
    }

    // --- CORRECCIÓN MATANZA EN SALIDA (PARCHÍS) ---
    if (killBonusPending) {
        console.log(`[Parchís] Matanza en salida detectada. Prioritizando bono de 20.`);
        killBonusHandled = true;

        const prizeDistance = 20;
        const prizeMoves = [];
        const activePiecesForPrize = playerPieces.filter(p => p.state === 'active');
        const allPieces = room.gameState.pieces;
        const boardRulesForPrize = room.gameState.board;

        activePiecesForPrize.forEach(piece => {
            const { finalPosition } = ludoCalculatePath(playerColor, piece.position, prizeDistance, boardRulesForPrize, allPieces, 'parchis');
            if (finalPosition !== null) {
                prizeMoves.push({
                    type: 'move_prize_piece',
                    pieceId: piece.id,
                    diceValue: prizeDistance,
                    targetPosition: finalPosition,
                    prizeMove: true
                });
            }
        });

        if (prizeMoves.length > 0) {
            console.log(`[Parchís] Se encontraron ${prizeMoves.length} movimientos de 20. Forzando movimiento de premio.`);
            
            turnData.dice = [dice1, dice2];
            turnData.moves = [];
            turnData.possibleMoves = prizeMoves;
            turnData.prizeMoves = prizeDistance;
            
            turnData.canRoll = false; // No puede tirar, debe mover el bono
            
            // CORRECCIÓN CLAVE: Solo se guarda el derecho a tirar de nuevo SI FUE DOBLE
            turnData.canRollAgain = isDouble; 

            io.to(room.roomId).emit('ludoDiceRolled', {
                playerId: socket.id,
                playerName,
                diceValues: [dice1, dice2],
                isDouble,
                turnData
            });
            return; // Esperamos a que el jugador mueva el bono
        } else {
            // El bono de 20 no se puede usar (se pierde)
            console.log(`[Parchís] No hay fichas para mover 20 casillas. El bono se pierde.`);
            
            turnData.prizeMoves = 0;
            turnData.dice = [dice1, dice2];
            turnData.moves = [];
            turnData.possibleMoves = [];

            if (isDouble) {
                // Si fue doble (ej. 5-5), pierde el bono pero tira de nuevo por el doble
                console.log(`[Parchís] Era DOBLE: Se permite tirar de nuevo.`);
                turnData.canRoll = true;
                turnData.canRollAgain = false; // Se consume el bono ahora mismo

                io.to(room.roomId).emit('ludoDiceRolled', {
                    playerId: socket.id,
                    playerName,
                    diceValues: [dice1, dice2],
                    isDouble,
                    turnData
                });
            } else {
                // Si NO fue doble (ej. 4-1), pierde el bono Y PIERDE EL TURNO
                console.log(`[Parchís] NO era doble: Se pasa el turno.`);
                turnData.canRoll = false;
                turnData.canRollAgain = false;

                io.to(room.roomId).emit('ludoDiceRolled', {
                    playerId: socket.id,
                    playerName,
                    diceValues: [dice1, dice2],
                    isDouble,
                    turnData
                });

                setTimeout(() => ludoPassTurn(room, io), 2200);
                return; // Detener ejecución
            }
        }
        return;
    }
    // --- FIN CORRECCIÓN ---

    const diceUsedForBlock = []; // TODO: Implementar lógica de romper bloqueo.

    if (diceUsedForBlock.includes('die1')) {
        remainingDice = remainingDice.filter((value, index) => !(value === dice1 && index === remainingDice.indexOf(dice1)));
    }
    if (diceUsedForBlock.includes('die2')) {
        const dieIndex = remainingDice.indexOf(dice2);
        if (dieIndex > -1) remainingDice.splice(dieIndex, 1);
    }
    if (diceUsedForBlock.includes('sum')) {
        remainingDice = [];
    }

    // ▼▼▼ INICIO: LÓGICA DE ROMPER BLOQUEO (PARCHÍS) ▼▼▼
    let blockadeBreakMoves = [];
    let usedDieForBlockade = null;

    if (isDouble && remainingDice.length > 0 && !blockadeJustCreatedOnStart) { // Solo si es doble, quedan dados Y NO SE ACABA DE CREAR UN BLOQUEO EN LA SALIDA
        const playerPiecesList = room.gameState.pieces[playerColor] || [];
        const activePiecesForBlock = playerPiecesList.filter((p) => p.state === 'active');
        const boardRulesForBlock = room.gameState.board;

        // 1. Encontrar posiciones de mis bloqueos (PROPIOS Y MIXTOS)

        // 1a. Obtener posiciones de TODAS las fichas activas oponentes
        const opponentPiecePositions = new Set();
        for (const color in room.gameState.pieces) {
            if (color === playerColor) continue; // Saltar mi propio color
            (room.gameState.pieces[color] || []).forEach(p => {
                if (p.state === 'active' && p.position !== -1) {
                    opponentPiecePositions.add(p.position);
                }
            });
        }

        // 1b. Encontrar dónde tengo YO un bloqueo propio (2 o más fichas mías)
        const myOwnBlockadePositions = new Set();
        const pieceCountMap = {};
        activePiecesForBlock.forEach(p => { // activePiecesForBlock ya contiene solo mis fichas
            if (p.position === -1) return;
            pieceCountMap[p.position] = (pieceCountMap[p.position] || 0) + 1;
            if (pieceCountMap[p.position] >= 2) {
                myOwnBlockadePositions.add(p.position);
            }
        });

        // 1c. Un bloqueo rompible es cualquier ficha mía que esté...
        // ...sobre una ficha oponente (mixto) O ...sobre otra ficha mía (propio)
        // PERO NO en la zona de meta ni en la meta final
        const homeStretch = boardRulesForBlock.home_stretch[playerColor] || [];
        const goalCell = boardRulesForBlock.goal[playerColor];
        const blockadePositionsSet = new Set();
        activePiecesForBlock.forEach(p => {
            if (p.position === -1) return;
            // Excluir la zona de meta y la meta final
            const isInHomeStretch = homeStretch.includes(p.position);
            const isGoal = (p.position === goalCell);
            if (isInHomeStretch || isGoal) return; // No considerar bloqueos en la zona de meta
            
            if (opponentPiecePositions.has(p.position) || myOwnBlockadePositions.has(p.position)) {
                blockadePositionsSet.add(p.position);
            }
        });

        const blockadePositions = Array.from(blockadePositionsSet);
        // --- FIN DE LA NUEVA LÓGICA DE DETECCIÓN ---

        if (blockadePositions.length > 0) {
            console.log(`[Parchís] ${playerName} sacó doble y tiene ${blockadePositions.length} bloqueo(s) (propios o mixtos) en [${blockadePositions.join(', ')}].`);

            const dieValue = dice1; // Usamos uno de los dados del doble (ej. el primero)
            usedDieForBlockade = dieValue; // Guardamos el dado que se usará

            // 2. Generar movimientos *solo* para las fichas en esos bloqueos
            blockadePositions.forEach(pos => {
                const piecesOnBlockade = activePiecesForBlock.filter(p => p.position === pos);

                // Iteramos sobre las fichas que forman el bloqueo (normalmente 2)
                piecesOnBlockade.forEach(piece => {
                    // Verificamos la ruta para mover esta ficha
                    const { finalPosition } = ludoCalculatePath(playerColor, piece.position, dieValue, boardRulesForBlock, room.gameState.pieces, 'parchis');

                    if (finalPosition !== null) {
                        blockadeBreakMoves.push({
                            type: 'move_active_piece',
                            startPosition: pos,
                            pieceId: piece.id,
                            diceValue: dieValue,
                            targetPosition: finalPosition,
                            isBlockadeBreak: true // Bandera especial (opcional)
                        });
                    }
                });
            });

            if (blockadeBreakMoves.length === 0) {
                console.log(`[Parchís] No se puede romper ningún bloqueo con un ${dieValue}.`);
                usedDieForBlockade = null; // No se pudo usar el dado
            }
        }
    }
    // ▲▲▲ FIN: LÓGICA DE ROMPER BLOQUEO (PARCHÍS) ▲▲▲

    if (isDouble && dice1 === 5 && diceUsedForExit.length === 1) {
        remainingDice = [5];
    }

    const possibleMoves = [];
    const boardRules = room.gameState.board;
    const activePieces = playerPieces.filter((p) => p.state === 'active');

    // ▼▼▼ INICIO: MODIFICACIÓN DE CÁLCULO DE MOVIMIENTOS (REEMPLAZO TOTAL) ▼▼▼

    if (blockadeBreakMoves.length > 0) {
        // ¡HAY QUE ROMPER BLOQUEO!
        const breakableBlockadePositions = [...new Set(blockadeBreakMoves.map(m => m.startPosition))];
        const dieValue = dice1; // El valor del dado del doble

        // -----------------------------------------------------------------
        // ESCENARIO 1: AUTO-MOVIMIENTO (Un solo bloqueo rompible)
        // -----------------------------------------------------------------
        if (breakableBlockadePositions.length === 1 && !blockadeJustCreatedOnStart) {
            console.log(`[Parchís] Auto-movimiento: Rompiendo único bloqueo en ${breakableBlockadePositions[0]}`);
            const autoMove = blockadeBreakMoves[0]; // Tomamos el primer movimiento válido (de la primera ficha)
            const pieceToMove = playerPieces.find(p => p.id === autoMove.pieceId);

            if (pieceToMove) {
                const startPosition = pieceToMove.position;
                const targetPosition = autoMove.targetPosition;

                // 1. Ejecutar el movimiento
                pieceToMove.position = targetPosition;

                // 2. Comprobar matanza
                let prizeMoveEarned = 0;
                if (ludoIsKillMove(targetPosition, playerColor, room.gameState.pieces, boardRules)) {
                    for (const color in room.gameState.pieces) {
                        if (color === playerColor) continue;
                        room.gameState.pieces[color].forEach(opponentPiece => {
                            if (opponentPiece.state === 'active' && opponentPiece.position === targetPosition) {
                                opponentPiece.state = 'base';
                                opponentPiece.position = -1;
                                prizeMoveEarned = 20;
                                console.log(`[Parchís] ¡Auto-movimiento mató a ${opponentPiece.id}! Premio de 20.`);
                            }
                        });
                    }
                }

                // ▼▼▼ INICIO DE LA MODIFICACIÓN (DOBLE 5-5) ▼▼▼
                let autoExitedWithSecond5 = false;
                // Comprobar si fue un 5-5 Y si quedan fichas en la base
                if (isDouble && dieValue === 5 && (playerPieces.filter(p => p.state === 'base').length > 0)) {
                    console.log(`[Parchís] Auto-movimiento 5-5: Usando el segundo 5 para salir de la base.`);

                    // Llamar a la función interna para sacar una ficha
                    const { killOccurred: killOnExit, pieceActivated } = activatePieceFromBase();

                    if (pieceActivated) {
                        autoExitedWithSecond5 = true;
                        if (killOnExit) {
                            prizeMoveEarned += 20; // Sumar al bono de matanza (si ya existía)
                            console.log(`[Parchís] ¡Auto-movimiento mató en salida! Premio de 20.`);
                        }

                        // Usamos el segundo 5
                        turnData.moves = []; // No quedan dados
                        remainingDice = []; // Actualizar variable local
                    } else {
                        // No se pudo salir (ej. la casa está bloqueada por 2 fichas PROPIAS)
                        console.log(`[Parchís] Auto-movimiento 5-5: No se pudo usar el segundo 5 para salir (bloqueado).`);
                        turnData.moves = [dieValue]; // El segundo 5 queda
                    }
                } else {
                    // Lógica original: El segundo dado (o el dado de la suma si no es 5-5) queda
                    turnData.moves = [dieValue];
                }
                // ▲▲▲ FIN DE LA MODIFICACIÓN (DOBLE 5-5) ▲▲▲

                // 3. Preparar el turno para el *segundo* dado
                turnData.dice = [dice1, dice2];
                turnData.canRoll = false;
                turnData.canRollAgain = true; // Guardar el bono del doble
                turnData.prizeMoves = (turnData.prizeMoves || 0) + prizeMoveEarned;
                turnData.lastMovedPieceId = pieceToMove.id;
                turnData.lastBreakdownStartPos = startPosition; // Guardar la casilla del bloqueo
                turnData.isForcedBlockadeBreak = false;

                // 4. Recalcular movimientos posibles
                possibleMoves.length = 0; // Reiniciar movimientos

                // Si NO salimos automáticamente Y AÚN quedan dados...
                if (!autoExitedWithSecond5 && remainingDice.length > 0) {
                    const remainingActivePieces = playerPieces.filter(p => 
                        p.state === 'active' && p.position !== startPosition // Excluir la ficha que quedó en el bloqueo
                    );

                    remainingActivePieces.forEach(piece => {
                        // Mover con el segundo dado
                        const { finalPosition: posDie } = ludoCalculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, 'parchis');
                        if (posDie !== null) {
                            possibleMoves.push({
                                type: 'move_active_piece', pieceId: piece.id, diceValue: dieValue, targetPosition: posDie
                            });
                        }
                        // Mover con la suma (6-6 -> 12)
                        const { finalPosition: posSum } = ludoCalculatePath(playerColor, piece.position, dieValue + dieValue, boardRules, room.gameState.pieces, 'parchis');
                        if (posSum !== null) {
                            possibleMoves.push({
                                type: 'move_active_piece', pieceId: piece.id, diceValue: (dieValue + dieValue), targetPosition: posSum
                            });
                        }
                    });
                }

                // ▼▼▼ AÑADIR ESTE BLOQUE (MANEJO DE ESTADO FINAL DEL TURNO) ▼▼▼
                if (autoExitedWithSecond5) {
                    // Se usaron ambos 5s. No hay más movimientos. Pasar al bono.
                    turnData.canRoll = true;     // Puede tirar de nuevo (Bono)
                    turnData.canRollAgain = false; // Bono se consume AHORA
                    turnData.moves = [];

                    // Emitir la animación de la segunda ficha (la que sale de casa)
                    setTimeout(() => {
                        if (ludoRooms[roomId] && ludoRooms[roomId].state === 'playing') {
                            // 'piecesActivated' fue llenado por la llamada a activatePieceFromBase()
                            io.to(roomId).emit('ludoGameStateUpdated', {
                                newGameState: room.gameState,
                                moveInfo: {
                                    type: 'parchis_auto_exit',
                                    playerColor,
                                    piecesMoved: piecesActivated, // piecesActivated es global a handleParchisRoll
                                    startPosition: startPos
                                }
                            });
                        }
                    }, 2500); // Retraso de 2.5s para la *segunda* animación

                } else if (possibleMoves.length === 0) {
                    // No se salió automáticamente, pero no hay movimientos para el segundo dado.
                    turnData.canRoll = true;     // Puede tirar de nuevo (Bono)
                    turnData.canRollAgain = false; // Bono se consume AHORA
                    turnData.moves = [];
                }
                // else: Hay movimientos posibles, 'canRoll' sigue en false, 'canRollAgain' en true.
                // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

                turnData.possibleMoves = possibleMoves;

                // 5. Emitir dados (para parar anim) y luego el movimiento (para actualizar UI)
                io.to(room.roomId).emit('ludoDiceRolled', {
                    playerId: socket.id, playerName, diceValues: [dice1, dice2], isDouble, turnData
                });

                setTimeout(() => {
                    if (ludoRooms[roomId] && ludoRooms[roomId].state === 'playing') {
                        const { path } = ludoCalculatePath(playerColor, startPosition, dieValue, boardRules, room.gameState.pieces, 'parchis');
                        io.to(roomId).emit('ludoGameStateUpdated', {
                            newGameState: room.gameState,
                            moveInfo: { 
                                type: 'move_active_piece', 
                                playerColor, 
                                pieceId: pieceToMove.id, 
                                startPosition, 
                                newPosition: targetPosition, 
                                movePath: path 
                            }
                        });
                    }
                }, 1200); // Retraso para que el cliente vea el dado antes del movimiento

                return; // Fin del 'handleParchisRoll'

            } else {
                 console.error(`[Parchís] Error en auto-movimiento: No se encontró la ficha ${autoMove.pieceId}`);
                 // Continuar con la lógica normal como fallback
            }
        } 
        // -----------------------------------------------------------------
        // ESCENARIO 2: FORZAR ELECCIÓN (Múltiples bloqueos) O JUGAR LIBRE (Bloqueo recién creado)
        // -----------------------------------------------------------------
        else {
            if (!blockadeJustCreatedOnStart) {
                console.log(`[Parchís] Forzando elección: Romper uno de los ${breakableBlockadePositions.length} bloqueos.`);
                possibleMoves.push(...blockadeBreakMoves);

                const dieIndex = remainingDice.indexOf(usedDieForBlockade);
                if (dieIndex > -1) {
                    remainingDice.splice(dieIndex, 1);
                } else if (remainingDice.length > 0) {
                    remainingDice.shift();
                }

                turnData.moves = remainingDice;
                turnData.possibleMoves = possibleMoves;
                turnData.isForcedBlockadeBreak = true;
                turnData.canRollAgain = true;
                turnData.lastBreakdownStartPos = null;
            } else {
                console.log(`[Parchís] Bloqueo recién creado en salida. Calculando TODOS los movimientos para el dado restante (${usedDieForBlockade}).`);

                const dieValue = usedDieForBlockade;
                if (typeof dieValue === 'number') {
                    const allActivePieces = playerPiecesList.filter((p) => p.state === 'active');
                    allActivePieces.forEach((piece) => {
                        const { finalPosition } = ludoCalculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, 'parchis');
                        if (finalPosition !== null) {
                            possibleMoves.push({
                                type: 'move_active_piece',
                                pieceId: piece.id,
                                diceValue: dieValue,
                                targetPosition: finalPosition
                            });
                        }
                    });
                } else {
                    console.warn(`[Parchís] No se pudo determinar el dado usado para bloqueo. Se omite el cálculo especial.`);
                }

                turnData.possibleMoves = possibleMoves;
                turnData.isForcedBlockadeBreak = false;
                turnData.canRollAgain = true;
                turnData.lastBreakdownStartPos = null;
            }
        }

    } else {
        // NO HAY BLOQUEO (o no es doble): Lógica normal
        // ▼▼▼ REEMPLAZA ESTA FUNCIÓN INTERNA COMPLETA ▼▼▼
        const addMovesForDie = (dieValue) => {
            activePieces.forEach((piece) => {
                const { finalPosition } = ludoCalculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, 'parchis');
                if (finalPosition !== null) {
                    // ▼▼▼ ¡LÍNEA AÑADIDA! ▼▼▼
                    const isKill = ludoIsKillMove(finalPosition, playerColor, room.gameState.pieces, boardRules);
                    
                    possibleMoves.push({
                        type: 'move_active_piece',
                        pieceId: piece.id,
                        diceValue: dieValue,
                        targetPosition: finalPosition,
                        isKill: isKill
                    });
                }
            });
        };
        // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

        remainingDice.forEach(addMovesForDie);

        if (remainingDice.length === 2) {
            const sumDice = remainingDice[0] + remainingDice[1];
            addMovesForDie(sumDice);
        }

        turnData.lastBreakdownStartPos = null;
    }

    // ▲▲▲ FIN: MODIFICACIÓN DE CÁLCULO DE MOVIMIENTOS (REEMPLAZO TOTAL) ▲▲▲

    // ▼▼▼ BLOQUE A AÑADIR (INICIO) ▼▼▼
    // --- Regla Parchís: Doble sin fichas activas ---
    // Si es doble, Y no hay fichas activas en el tablero, Y no se activó ninguna ficha (ej. no fue 5-5)
    if (isDouble && activePieces.length === 0 && piecesActivated.length === 0) {
        console.log(`[Parchís] ${playerName} sacó doble (${dice1}) sin fichas activas. Pierde el doble y vuelve a tirar.`);

        // Configurar el turno para volver a tirar, perdiendo el doble
        turnData.dice = [dice1, dice2];
        turnData.moves = []; // No hay dados para usar
        turnData.possibleMoves = []; // No hay movimientos
        turnData.canRollAgain = false; // El "doble" se pierde
        turnData.canRoll = true; // Se permite volver a tirar
        turnData.prizeMoves = turnData.prizeMoves || 0;

        // Emitir el resultado (el cliente verá que puede tirar de nuevo)
        io.to(room.roomId).emit('ludoDiceRolled', {
            playerId: socket.id,
            playerName,
            diceValues: [dice1, dice2],
            isDouble,
            turnData
        });
        
        // Detener la ejecución de esta función
        return; 
    }
    // ▲▲▲ BLOQUE A AÑADIR (FIN) ▲▲▲

    // ▼▼▼ NUEVO BLOQUE A AÑADIR (INICIO) ▼▼▼
    // --- Regla Parchís: Tiro normal (no 5) sin fichas activas ---
    // Si NO es doble, Y no hay fichas activas, Y no se activó ninguna ficha (no fue un 5 o suma 5)
    if (!isDouble && activePieces.length === 0 && piecesActivated.length === 0) {
        console.log(`[Parchís] ${playerName} sacó ${dice1}-${dice2} sin fichas activas y sin 5. Pierde el turno.`);

        // Configurar el turno para pasar
        turnData.dice = [dice1, dice2];
        turnData.moves = []; // No hay dados para usar
        turnData.possibleMoves = []; // No hay movimientos
        turnData.canRollAgain = false; // No hay bono
        turnData.canRoll = false; // No puede tirar (debe pasar)
        turnData.prizeMoves = turnData.prizeMoves || 0;

        // Emitir el resultado (el cliente verá los dados y luego pasará el turno)
        io.to(room.roomId).emit('ludoDiceRolled', {
            playerId: socket.id,
            playerName,
            diceValues: [dice1, dice2],
            isDouble,
            turnData
        });
        
        // Pasar el turno después de una breve espera
        setTimeout(() => ludoPassTurn(room, io), 2200);
        return; // Detener la ejecución de esta función
    }
    // ▲▲▲ NUEVO BLOQUE A AÑADIR (FIN) ▲▲▲

    // ▼▼▼ BLOQUE A AÑADIR (INICIO) ▼▼▼
    // --- Regla Parchís: Doble 5-5 usado para salir ---
    // Si es doble 5, Y se usaron ambos dados para salir (diceUsedForExit.length === 2),
    // Y por lo tanto no quedan dados (remainingDice.length === 0)
    // Y no hay movimientos de rotura de bloqueo (blockadeBreakMoves.length === 0)
    if (isDouble && dice1 === 5 && diceUsedForExit.length === 2 && remainingDice.length === 0 && blockadeBreakMoves.length === 0 && !killBonusHandled) {
        console.log(`[Parchís] ${playerName} usó doble 5-5 para salir. Otorga bono de 'volver a tirar' INMEDIATAMENTE.`);
        
        // Configurar el turno para volver a tirar
        turnData.dice = [dice1, dice2];
        turnData.moves = []; // No hay dados para usar
        turnData.possibleMoves = []; // No hay movimientos
        turnData.canRollAgain = false; // El "doble" se consume para volver a tirar
        turnData.canRoll = true; // Se permite volver a tirar
        turnData.prizeMoves = turnData.prizeMoves || 0;

        // Emitir el resultado (el cliente verá que puede tirar de nuevo)
        io.to(room.roomId).emit('ludoDiceRolled', {
            playerId: socket.id,
            playerName,
            diceValues: [dice1, dice2],
            isDouble,
            turnData
        });
        
        // Detener la ejecución de esta función
        return; 
    }
    // ▲▲▲ BLOQUE A AÑADIR (FIN) ▲▲▲

    turnData.dice = [dice1, dice2];
    turnData.moves = remainingDice;
    turnData.possibleMoves = possibleMoves;
            const doubleBonus = isDouble;
    turnData.canRollAgain = doubleBonus;
    turnData.canRoll = false;
    turnData.prizeMoves = turnData.prizeMoves || 0;

    io.to(room.roomId).emit('ludoDiceRolled', {
        playerId: socket.id,
        playerName,
        diceValues: [dice1, dice2],
        isDouble,
        turnData
    });

    // ▼▼▼ BLOQUE A AÑADIR (INICIO) ▼▼▼
    // --- MANEJO CENTRALIZADO DE "SIN MOVIMIENTOS" (SOLUCIONA PROBLEMAS 1 Y 2) ---
    if (possibleMoves.length === 0) {
        if (isDouble) {
            // PROBLEMA 2 (Solución): Es un doble sin movimientos (ej. 6-6 en la meta).
            // El 'emit' anterior ya envió canRoll=false, canRollAgain=true.
            // Necesitamos corregir esto y decirle que tire de nuevo AHORA.
            console.log(`[Parchís] ${playerName} sacó doble ${dice1} pero no tiene movimientos. Activando bono de 'volver a tirar'.`);
            
            // Actualizar el estado del turno para reflejar el "roll again"
            turnData.canRoll = true;     // Se permite volver a tirar
            turnData.canRollAgain = false; // El bono del doble se consume
            turnData.moves = [];
            
            // RE-EMITIR el estado corregido
            io.to(room.roomId).emit('ludoDiceRolled', {
                playerId: socket.id,
                playerName,
                diceValues: [dice1, dice2],
                isDouble,
                turnData // Enviamos el estado corregido
            });
            return; // FIN

        } else {
            // PROBLEMA 1 (Solución): Es un tiro normal sin movimientos (ej. 4-5 en la meta).
            // El 'emit' anterior ya envió canRoll=false.
            console.log(`[Parchís] ${playerName} sacó ${dice1}-${dice2} pero no tiene movimientos. Pasando turno...`);
            setTimeout(() => ludoPassTurn(room, io), 2200); // Pasar el turno
            return; // FIN
        }
    }
    
    // Si hay movimientos, verificar si se deben pasar dados restantes (Regla parchís)
    if (remainingDice.length === 0 && !isDouble) {
        turnData.canRoll = false;
        setTimeout(() => ludoPassTurn(room, io), 2200);
    }
    // ▲▲▲ BLOQUE A AÑADIR (FIN) ▲▲▲

    // (Bloque legacy de “sin movimientos” sustituido por la lógica centralizada previa)
}

// === isKillMove ===
function ludoIsKillMove(targetPosition, myColor, pieces, boardRules) {
    // Obtener las casillas seguras
    const allSafeSquares = [
        ...boardRules.safe,
        ...boardRules.startSafe
    ];
    
    // Si la posición de destino es segura, no se puede matar
    if (allSafeSquares.includes(targetPosition)) {
        return false;
    }
    
    // Verificar si hay una ficha oponente en la posición de destino
    for (const color in pieces) {
        if (color === myColor) continue; // Saltar mis propias fichas
        
        const opponentPieces = pieces[color];
        for (const opponentPiece of opponentPieces) {
            if (opponentPiece.state === 'active' && opponentPiece.position === targetPosition) {
                return true; // Hay una ficha oponente que sería matada
            }
        }
    }
    
    return false; // No hay fichas oponentes en la posición de destino
}

// === calculatePath ===
function ludoCalculatePath(color, currentPosition, diceValue, boardRules, allPieces = {}, gameType = 'ludo') {
    // Si está en base, no se puede mover con esta función (se maneja aparte)
    if (currentPosition === -1) return { finalPosition: null, path: [] };

    const entryPoint = boardRules.entry[color];
    const homeStretch = boardRules.home_stretch[color];
    const goalCell = boardRules.goal[color];
    let newPosition = currentPosition;
    let pathTaken = []; // Guarda las casillas intermedias

    for (let i = 0; i < diceValue; i++) {
        let nextStepPosition;

            if (gameType === 'parchis' && allPieces) {
            let tempNextStep = newPosition;
            if (tempNextStep === goalCell) {
                tempNextStep = goalCell;
            } else if (homeStretch.includes(tempNextStep) && tempNextStep === homeStretch[homeStretch.length - 1]) {
                tempNextStep = goalCell;
            } else if (homeStretch.includes(tempNextStep)) {
                const currentIndex = homeStretch.indexOf(tempNextStep);
                tempNextStep = homeStretch[currentIndex + 1];
            } else if (tempNextStep === entryPoint) {
                tempNextStep = homeStretch[0];
            } else {
                if (tempNextStep === 68 && color !== 'yellow') {
                    tempNextStep = 1;
                } else if (ludoBoardJumps[tempNextStep]) {
                    tempNextStep = ludoBoardJumps[tempNextStep];
                } else {
                    tempNextStep = tempNextStep + 1;
                }

                if (color === 'yellow' && tempNextStep === 1 && newPosition === 68) {
                    tempNextStep = homeStretch[0];
                }
            }

            // --- INICIO DE LA CORRECCIÓN DE BLOQUEO MIXTO ---
            let totalPiecesOnSquare = 0;
            let colorsOnSquare = [];
            for (const c in allPieces) {
                const pieces = (allPieces[c] || []).filter(p => p.state === 'active' && p.position === tempNextStep);
                if (pieces.length > 0) {
                    totalPiecesOnSquare += pieces.length;
                    colorsOnSquare.push(c); // Almacena los colores presentes
                }
            }

            let blockadeColor = null;
            if (totalPiecesOnSquare >= 2) {
                // ¡Se detectó un bloqueo (propio O mixto)!
                if (colorsOnSquare.length === 1) {
                    // Es un bloqueo propio (2+ fichas del mismo color)
                    blockadeColor = colorsOnSquare[0];
                } else {
                    // Es un bloqueo mixto.
                    // Lo tratamos como un bloqueo oponente para el jugador que se mueve (color).
                    blockadeColor = colorsOnSquare.find(c => c !== color) || colorsOnSquare[0];
                }
            }
            // --- FIN DE LA CORRECCIÓN DE BLOQUEO MIXTO ---

            // --- REGLA PARCHÍS: BLOQUEO ESTRICTO (MAX 2) ---
            if (blockadeColor !== null) { 
                // Si hay 2 o más fichas en la siguiente casilla...

                // ▼▼▼ MODIFICACIÓN: EXCLUIR ZONA DE META Y META ▼▼▼
                // Verificamos si la casilla destino es parte de MI camino de color o MI meta
                const isHomeStretch = boardRules.home_stretch[color].includes(tempNextStep);
                const isGoal = (tempNextStep === boardRules.goal[color]);

                if (isHomeStretch || isGoal) {
                    // CASO ZONA DE META:
                    // Aquí NO APLICAN los bloqueos. Las fichas del mismo color pueden
                    // apilarse (hasta 4) y pasarse por encima libremente.
                    // Simplemente dejamos continuar el bucle sin retornar null.
                    
                    // (Opcional de seguridad: evitar más de 4 fichas en una celda física)
                    if (totalPiecesOnSquare >= 4) {
                         return { finalPosition: null, path: [] };
                    }

                } else {
                    // CASO TABLERO COMÚN:
                    // Aquí SÍ aplica el bloqueo estricto. No se puede pasar ni aterrizar
                    // si hay 2 fichas (propias o ajenas).
                    console.log(`[calculatePath] BLOQUEO ESTRICTO (MAX 2). ${color} no puede pasar/aterrizar en el bloqueo (Total: ${totalPiecesOnSquare}) de ${blockadeColor} en ${tempNextStep}`);
                    return { finalPosition: null, path: [] };
                }
                // ▲▲▲ FIN MODIFICACIÓN ▲▲▲
            }
            // --- FIN REGLA PARCHÍS ---
        }

        // ▼▼▼ BLOQUE CORREGIDO ▼▼▼

        if (newPosition === goalCell) {
            console.log(`[Rebote] La ficha ${color} ya está en la meta ${goalCell} o aterrizó antes y rebotó.`);
            return { finalPosition: null, path: [] };
        }

        const homeStretchIndex = homeStretch.indexOf(newPosition);

        if (homeStretchIndex !== -1) {
            if (homeStretchIndex === homeStretch.length - 1) {
                nextStepPosition = goalCell;
            } else {
                nextStepPosition = homeStretch[homeStretchIndex + 1];
            }

            if (gameType === 'parchis') {
                const stepsToGoal = (homeStretch.length - homeStretchIndex);
                const stepsRemainingOnDice = (diceValue - i);

                if (stepsRemainingOnDice > stepsToGoal) {
                    console.log(`[Rebote Parchís] ${color} en ${newPosition} necesita ${stepsToGoal}, pero el dado/restante es ${stepsRemainingOnDice}. REBOTE.`);
                    return { finalPosition: null, path: [] };
                }
            }
        }
        else if (newPosition === entryPoint) {
            nextStepPosition = homeStretch[0];
        }
        else {
            if (newPosition === 68 && color !== 'yellow') {
                nextStepPosition = 1;
            }
            else if (ludoBoardJumps[newPosition]) {
                nextStepPosition = ludoBoardJumps[newPosition];
            }
            else {
                nextStepPosition = newPosition + 1;
            }

            if (color === 'yellow' && nextStepPosition === 1 && newPosition === 68) {
                 nextStepPosition = homeStretch[0];
            }
        }
        // ▲▲▲ FIN DEL BLOQUE CORREGIDO ▲▲▲

        newPosition = nextStepPosition; // Actualiza la posición para el siguiente paso
        pathTaken.push(newPosition);    // Añade la casilla al camino

        // Si llegó a la meta antes de terminar los pasos (solo posible si fue exacto)
        if (newPosition === goalCell && i === diceValue - 1) {
             break;
        }
    }

    // Devolvemos la posición final y la ruta
    return { finalPosition: newPosition, path: pathTaken };
}

// === checkWinCondition ===
function ludoCheckWinCondition(room, playerColor) {
    if (!room || !room.gameState || !room.gameState.pieces[playerColor]) {
        return false;
    }

    const pieces = room.gameState.pieces[playerColor];
    const pieceCount = room.settings.pieceCount || 4; // Obtiene el total de fichas de la config
    const goalCell = room.gameState.board.goal[playerColor];
    
    let piecesInGoal = 0;
    
    pieces.forEach(piece => {
        // Verificamos si la ficha está en la meta final
        if (piece.state === 'active' && piece.position === goalCell) {
            piecesInGoal++;
        }
    });

    console.log(`[WinCheck] Jugador ${playerColor} tiene ${piecesInGoal} / ${pieceCount} fichas en la meta.`);
    
    if (piecesInGoal !== pieceCount) return false;

    const gameType = room.settings.gameType || 'ludo';
    const isGroups = gameType === 'parchis' && room.settings.parchisMode === '4-groups';

    if (isGroups) {
        const mySeatIndex = room.seats.findIndex(s => s && s.color === playerColor);
        if (mySeatIndex === -1) return false;
        const partnerSeatIndex = (mySeatIndex + 2) % 4;
        const partnerSeat = room.seats[partnerSeatIndex];
        if (!partnerSeat) return false;

        const partnerColor = partnerSeat.color;
        const partnerPieces = room.gameState.pieces[partnerColor];
        const partnerGoalCell = room.gameState.board.goal[partnerColor];
        if (!partnerPieces || partnerGoalCell === undefined) return false;

        let partnerPiecesInGoal = 0;
        partnerPieces.forEach(piece => {
            if (piece.state === 'active' && piece.position === partnerGoalCell) {
                partnerPiecesInGoal++;
            }
        });

        return partnerPiecesInGoal === pieceCount;
    }

    return true;
}


// ▲▲▲ FIN FUNCIONES AUXILIARES DE LUDO ▲▲▲

// --- INICIO: SECCIÓN DE ADMINISTRACIÓN ---

// Middleware de autenticación simple para el panel de admin
const adminAuth = (req, res, next) => {
    // Define aquí tu usuario y contraseña. ¡Cámbialos por algo seguro!
    const ADMIN_USER = "angelohh18";
    const ADMIN_PASS = "ANGELO51";

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === ADMIN_USER && password === ADMIN_PASS) {
        // Si las credenciales son correctas, permite el acceso.
        return next();
    }

    // Si no, pide las credenciales.
    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Autenticación requerida.');
};

// --- DEFINICIÓN DE RUTAS DE LA APLICACIÓN ---

// 1. Middleware para parsear JSON (debe ir ANTES de las rutas que lo usan)
// Ya está definido arriba en la línea 11

// 2. Rutas de la API (deben ir PRIMERO)

// RUTA DE REGISTRO
app.post('/register', async (req, res) => {
    // Desestructuración de datos - AÑADIR los campos de consentimiento
    const { 
        name, 
        country, 
        whatsapp, 
        password, 
        avatar, 
        currency,
        acceptedTerms,
        acceptedPrivacy
    } = req.body;

    // VALIDACIÓN BÁSICA: Asegúrate de que los campos vengan
    if (!name || !password || !currency) {
        return res.status(400).json({ success: false, message: 'Nombre, contraseña y moneda son obligatorios.' });
    }

    // Validar que los campos de consentimiento estén presentes
    if (!acceptedTerms || !acceptedPrivacy) {
        return res.status(400).json({ success: false, message: 'Faltan datos requeridos (incluyendo el consentimiento legal).' });
    }

    try {
    if (DISABLE_DB) {
      const username = name.toLowerCase();
      if (inMemoryUsers.has(username)) {
        return res.status(409).json({ success: false, message: 'Este nombre de usuario ya está en uso.' });
      }
      inMemoryUsers.set(username, {
        username,
        password_hash: password,
        country,
        whatsapp,
        avatar_url: avatar,
        currency,
        credits: 0.0,
        created_at: new Date().toISOString(),
        accepted_terms_at: acceptedTerms,
        accepted_privacy_at: acceptedPrivacy
      });
      
      // Actualizar panel de administración en tiempo real
      try {
        const allUsers = await getAllUsersFromDB();
        const fullUsers = await getFullUsersFromDB();
        io.to('admin-room').emit('admin:userList', allUsers);
        io.to('admin-room').emit('admin:fullUserList', fullUsers);
      } catch (updateError) {
        console.error('Error actualizando panel de administración:', updateError);
      }
      
      return res.status(201).json({ success: true, message: 'Usuario registrado exitosamente.' });
    }

    if (!pool) {
      console.error('❌ Error: Pool de base de datos no está disponible');
      return res.status(500).json({ 
        success: false, 
        message: 'Error de configuración del servidor. La base de datos no está disponible.' 
      });
    }

    const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [name.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Este nombre de usuario ya está en uso.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Consulta de inserción - AÑADIR las columnas y los valores
    await pool.query(
      'INSERT INTO users (username, password_hash, country, whatsapp, avatar_url, currency, credits, accepted_terms_at, accepted_privacy_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [name.toLowerCase(), passwordHash, country, whatsapp, avatar, currency, 0.00, acceptedTerms, acceptedPrivacy]
    );

    // Actualizar panel de administración en tiempo real
    try {
      const allUsers = await getAllUsersFromDB();
      const fullUsers = await getFullUsersFromDB();
      io.to('admin-room').emit('admin:userList', allUsers);
      io.to('admin-room').emit('admin:fullUserList', fullUsers);
    } catch (updateError) {
      console.error('Error actualizando panel de administración:', updateError);
    }

    res.status(201).json({ success: true, message: 'Usuario registrado exitosamente.' });

    } catch (error) {
        console.error('Error en el registro:', error);
        console.error('Detalles del error:', error.message);
        console.error('Stack trace:', error.stack);
        // MODIFICACIÓN: Enviamos el error completo al cliente para depuración
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor: ' + error.message, // Añadimos el mensaje de error
            error: error.stack // Añadimos el stack completo
        });
    }
});

// RUTA DE LOGIN
app.get('/login', (req, res) => {
    res.status(405).json({ success: false, message: 'Método no permitido. Use POST.' });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Por favor, ingresa nombre y contraseña.' });
    }

    try {
        if (DISABLE_DB) {
            const userLocal = inMemoryUsers.get(username.toLowerCase());
            if (!userLocal) {
                return res.status(404).json({ success: false, message: 'Usuario no encontrado (modo local).' });
            }
      const match = password === userLocal.password_hash;
            if (!match) {
                return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
            }
      const sessionToken = createSessionToken(userLocal.username);
            return res.status(200).json({
                success: true,
                message: 'Inicio de sesión exitoso (modo local).',
        sessionToken,
                user: {
                    name: userLocal.username,
                    avatar: userLocal.avatar_url,
                    credits: parseFloat(userLocal.credits || 0),
                    currency: userLocal.currency || 'USD'
                }
            });
        } else {
            if (!pool) {
                console.error('❌ Error: Pool de base de datos no está disponible');
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error de configuración del servidor. La base de datos no está disponible.' 
                });
            }

            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Usuario no encontrado. Debes registrarte primero.' });
            }

            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password_hash);

            if (match) {
        const sessionToken = createSessionToken(user.username);
                res.status(200).json({
                    success: true,
                    message: 'Inicio de sesión exitoso.',
          sessionToken,
                    user: {
                        name: user.username,
                        avatar: user.avatar_url,
                        credits: parseFloat(user.credits),
                        currency: user.currency
                    }
                });
            } else {
                res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
            }
        }
    } catch (error) {
        console.error('Error en el login:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/session-login', async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ success: false, message: 'Token requerido.' });
  }

  const normalizedUsername = getSessionUser(token);
  if (!normalizedUsername) {
    return res.status(401).json({ success: false, message: 'Sesión inválida o expirada.' });
  }

  try {
    let userRecord;
    if (DISABLE_DB) {
      userRecord = inMemoryUsers.get(normalizedUsername);
    } else {
      if (!pool) {
        return res.status(500).json({ 
          success: false, 
          message: 'Error de configuración del servidor. La base de datos no está disponible.' 
        });
      }
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [normalizedUsername]);
      userRecord = result.rows[0];
    }

    if (!userRecord) {
      invalidateSession(token);
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    res.status(200).json({
      success: true,
      sessionToken: token,
      user: {
        name: userRecord.username,
        avatar: userRecord.avatar_url,
        credits: parseFloat(userRecord.credits || 0),
        currency: userRecord.currency || 'USD'
      }
    });
  } catch (error) {
    console.error('Error validando sesión:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

app.post('/logout', (req, res) => {
  const { token } = req.body || {};
  if (token) {
    invalidateSession(token);
  }
  res.status(200).json({ success: true });
});

// ▼▼▼ ENDPOINT PARA ACTUALIZAR EL AVATAR DEL USUARIO ▼▼▼
app.post('/update-avatar', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { username, avatar } = req.body;
    
    console.log('[UPDATE-AVATAR] Recibida petición:', { username: username ? 'presente' : 'ausente', avatarLength: avatar ? avatar.length : 0 });
    
    if (!username || !avatar) {
      console.error('[UPDATE-AVATAR] Error: Datos incompletos', { username: !!username, avatar: !!avatar });
      return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    }

    const userId = 'user_' + username.toLowerCase();
    console.log('[UPDATE-AVATAR] Actualizando avatar para:', userId);
    
    // Actualizar en la base de datos
    await updateUserAvatar(userId, avatar);
    console.log('[UPDATE-AVATAR] Avatar actualizado en BD para:', userId);
    
    // Actualizar en memoria si existe
    if (users[userId]) {
      users[userId].avatar_url = avatar;
      console.log('[UPDATE-AVATAR] Avatar actualizado en memoria para:', userId);
    } else {
      console.log('[UPDATE-AVATAR] Usuario no encontrado en memoria:', userId);
    }
    
    // Si el usuario está conectado, notificarle
    let notified = false;
    for (const [id, socketInstance] of io.of("/").sockets) {
      if (socketInstance.userId === userId) {
        socketInstance.emit('avatarUpdated', { avatar });
        notified = true;
        console.log('[UPDATE-AVATAR] Notificación enviada por socket a:', userId);
        break;
      }
    }
    if (!notified) {
      console.log('[UPDATE-AVATAR] Usuario no conectado por socket:', userId);
    }
    
    res.status(200).json({ success: true, message: 'Avatar actualizado correctamente.' });
  } catch (error) {
    console.error('[UPDATE-AVATAR] Error:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el avatar: ' + error.message });
  }
});
// ▲▲▲ FIN DEL ENDPOINT update-avatar ▲▲▲

// ▼▼▼ CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ▼▼▼
// Servir archivos estáticos desde el directorio public
app.use(express.static(path.join(__dirname, 'public')));
console.log('✅ Archivos estáticos configurados desde:', path.join(__dirname, 'public'));
// ▲▲▲ FIN DE CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ▲▲▲

// RUTA DE ADMIN GENERAL (panel único para todos los juegos)
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// RUTAS PARA DOCUMENTOS LEGALES
app.get('/terminos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terminos.html'));
});

app.get('/privacidad', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacidad.html'));
});

// RUTA DE TEST DE BASE DE DATOS
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as db_version');
    res.json({
      status: 'success',
      message: 'Conexión a la base de datos exitosa',
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Error conectando a la base de datos',
      error: error.message
    });
  }
});

// ▼▼▼ FUNCIÓN PARA SANITIZAR DATOS DE SALA PARA EL CLIENTE ▼▼▼
function getSanitizedRoomForClient(room) {
    if (!room) return null;

    // Calculamos los contadores de cartas aquí, una sola vez.
    const playerHandCounts = {};
    if (room.seats && room.playerHands) {
        room.seats.forEach(seat => {
            if (seat && room.playerHands[seat.playerId]) {
                playerHandCounts[seat.playerId] = room.playerHands[seat.playerId].length;
            }
        });
    }

    // Creamos un objeto "limpio" solo con la información pública y necesaria.
    const sanitizedRoom = {
        roomId: room.roomId,
        hostId: room.hostId,
        settings: room.settings,
        seats: room.seats,
        state: room.state,
        discardPile: room.discardPile || [],
        melds: room.melds || [],
        spectators: room.spectators || [],
        playerHandCounts: playerHandCounts,
        currentPlayerId: room.currentPlayerId,
        pot: room.pot || 0,
        chatHistory: room.chatHistory || []
    };
    
    // NUNCA enviamos 'deck' o 'playerHands' completos por seguridad.
    return sanitizedRoom;
}
// ▲▲▲ FIN DE LA FUNCIÓN getSanitizedRoomForClient ▲▲▲

function buildDeck() {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const values = [
    { v: "A", p: 10 }, { v: "2", p: 2 }, { v: "3", p: 3 }, { v: "4", p: 4 }, 
    { v: "5", p: 5 }, { v: "6", p: 6 }, { v: "7", p: 7 }, { v: "8", p: 8 }, 
    { v: "9", p: 9 }, { v: "10", p: 10 }, { v: "J", p: 10 }, { v: "Q", p: 10 }, 
    { v: "K", p: 10 }
  ];
  let deck = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of suits) {
      for (const val of values) {
        deck.push({ 
          suit: suit, 
          value: val.v, 
          points: val.p, 
          id: `${val.v}-${suit}-${copy}`
        });
      }
    }
  }
  return deck;
}

function getCardColor(card) {
    if (!card) return null;
    if (card.suit === 'hearts' || card.suit === 'diamonds') return 'red';
    return 'black';
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function resetTurnState(room) {
    if (room) {
        room.turnMelds = [];
        room.turnPoints = 0;
        room.hasDrawn = false;
        room.drewFromDiscard = null;
        room.discardCardRequirementMet = false;
    }
}

function resetRoomForNewGame(room) {
    if (!room) return;

    room.state = 'playing';
    room.melds = [];
    room.deck = [];
    room.discardPile = [];
    room.turnMelds = [];
    room.turnPoints = 0;
    room.hasDrawn = false;
    room.drewFromDiscard = null;
    room.firstMeldCompletedByAnyone = false;
    
    // ▼▼▼ BLOQUE OBSOLETO ELIMINADO - Ya no se usa esta lógica de reset manual ▼▼▼
    console.log(`Sala ${room.roomId} reseteada para una nueva partida.`);
}

function isValidRun(cards) {
    if (!cards || cards.length < 3) return false;

    // Regla 1: Todas las cartas deben ser del mismo palo.
    const firstSuit = cards[0].suit;
    if (!cards.every(c => c.suit === firstSuit)) return false;

    // Regla 2: No puede haber valores de carta duplicados.
    if (new Set(cards.map(c => c.value)).size !== cards.length) return false;

    // --- INICIO DE LA LÓGICA ESTRICTA (VALIDA EL ORDEN) ---
    const order = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    // 3. Verificamos la secuencia par por par, tal como vienen las cartas.
    for (let i = 0; i < cards.length - 1; i++) {
        const currentRank = order.indexOf(cards[i].value);
        const nextRank = order.indexOf(cards[i+1].value);

        // Comprueba si es una secuencia normal (ej: 7 -> 8)
        const isStandardSequence = nextRank === currentRank + 1;
        
        // Comprueba el caso especial de la secuencia que pasa de Rey a As (ej: Q -> K -> A)
        const isKingToAce = currentRank === 12 && nextRank === 0;

        // Si no se cumple ninguna de las dos condiciones, el orden es incorrecto.
        if (!isStandardSequence && !isKingToAce) {
            return false; // ¡FALTA! El orden es incorrecto.
        }
    }

    // Si el bucle termina, la escalera es válida y está en el orden correcto.
    return true;
    // --- FIN DE LA LÓGICA ESTRICTA ---
}

function sortCardsForRun(cards) {
  if (!cards || cards.length === 0) return cards;
  
  const order = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  
  // Determinar si el As es alto o bajo basándose en las otras cartas
  const nonAceCards = cards.filter(c => c.value !== 'A');
  const hasKing = nonAceCards.some(c => c.value === 'K');
  const hasTwo = nonAceCards.some(c => c.value === '2');
  
  let aceIsHigh = false;
  if (hasKing && !hasTwo) {
    aceIsHigh = true;
  }
  
  return cards.sort((a, b) => {
    let rankA = order.indexOf(a.value) + 1;
    let rankB = order.indexOf(b.value) + 1;
    
    if (a.value === 'A') rankA = aceIsHigh ? 14 : 1;
    if (b.value === 'A') rankB = aceIsHigh ? 14 : 1;
    
    return rankA - rankB;
  });
}

// ▼▼▼ PEGA ESTA FUNCIÓN "INTELIGENTE" COMPLETA ▼▼▼
// Esta función será usada EXCLUSIVAMENTE por los bots.
function validateMeldAndCorrect(cards) {
    if (!cards || cards.length < 3) return false;

    // Intenta validar como si fuera un grupo (Set)
    const suits = new Set(cards.map(c => c.suit));
    const values = new Set(cards.map(c => c.value));

    if (values.size === 1 && suits.size === cards.length && (cards.length === 3 || cards.length === 4)) {
        const perms = [ [0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0] ];
        if (cards.length === 3) {
            for (const p of perms) {
                const reordered = [cards[p[0]], cards[p[1]], cards[p[2]]];
                if (isValidSet(reordered)) {
                    return { type: 'grupo', cards: reordered };
                }
            }
        } else if (isValidSet(cards)) { // Para 4 cartas, la validación simple suele bastar
             return { type: 'grupo', cards: cards };
        }
    }

    // Intenta validar como si fuera una escalera (Run)
    if (suits.size === 1) {
        const sortedRun = sortCardsForRun([...cards]);
        if (isValidRun(sortedRun)) {
            return { type: 'escalera', cards: sortedRun };
        }
    }
    
    return false;
}

// ▼▼▼ FUNCIÓN validateMeld ESTRICTA Y ORIGINAL (PARA HUMANOS) ▼▼▼
function validateMeld(cards) {
    if (isValidSet(cards)) {
        return 'grupo';
    }
    if (isValidRun(cards)) {
        return 'escalera';
    }
    return false;
}

// Pega esta función completa en tu server.js
function analyzeAndSuggestCorrection(cards) {
    if (!cards || cards.length < 3) return { suggestion: null, explanation: null };

    const originalOrder = cards.map(c => c.value).join('-');
    const suits = new Set(cards.map(c => c.suit));
    const values = new Set(cards.map(c => c.value));

    // Intenta corregir como si fuera una escalera
    if (suits.size === 1) {
        const sortedCards = sortCardsForRun([...cards]);
        if (isValidRun(sortedCards)) {
            const correctOrder = sortedCards.map(c => c.value).join('-');
            if (originalOrder !== correctOrder) {
                return {
                    suggestion: sortedCards,
                    explanation: `El orden de la escalera era incorrecto. La secuencia correcta es ${correctOrder}.`
                };
            }
        }
    }

    // Intenta corregir como si fuera un grupo
    if (values.size === 1) {
        // La falta más común en grupos es el orden de colores.
        // Buscamos una permutación que sí sea válida.
        // (Esta es una lógica simplificada para el ejemplo más común)
        if (cards.length === 3) {
            const perms = [ [0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0] ];
            for (const p of perms) {
                const reordered = [cards[p[0]], cards[p[1]], cards[p[2]]];
                if (isValidSet(reordered)) {
                     return {
                        suggestion: reordered,
                        explanation: `El orden de los colores no era válido. Los colores deben alternarse (rojo/negro).`
                    };
                }
            }
        }
    }
    
    return { suggestion: null, explanation: 'No se encontró una corrección simple.' };
}

function isValidSet(cards) {
    if (!cards || (cards.length !== 3 && cards.length !== 4)) {
        return false;
    }

    const firstValue = cards[0].value;
    // 1. Todas las cartas deben tener el mismo valor.
    if (!cards.every(c => c.value === firstValue)) {
        return false;
    }

    // 2. Los palos DEBEN ser únicos.
    const suits = cards.map(c => c.suit);
    if (new Set(suits).size !== cards.length) {
        return false; // FALTA: Palos repetidos.
    }
    
    // 3. (NUEVO) No puede haber dos cartas del mismo color seguidas.
    // Esta regla se deriva de la de palos únicos, pero la hacemos explícita para robustez.
    // Esta validación NO reordena las cartas.
    for (let i = 1; i < cards.length; i++) {
        if (getCardColor(cards[i]) === getCardColor(cards[i-1])) {
             return false; // FALTA: Dos colores iguales consecutivos.
        }
    }

    return true; // Si todo pasa, el grupo es válido.
}
function calculateMeldPoints(cards, type) {
        let pts = 0;
        if (type === 'escalera') {
            const hasKing = cards.some(x => x.value === 'K');
            const hasTwo = cards.some(x => x.value === '2');
            const aceIsHigh = hasKing && !hasTwo; 
            for (let c of cards) {
                if (c.value === 'A') {
                    pts += aceIsHigh ? 10 : 1;
                } else {
                    pts += c.points;
                }
            }
        } else { 
            for (let c of cards) {
                pts += c.points; 
            }
        }
        return pts;
    }

function canBeAddedToServerMeld(card, meld) {
  if (!meld || !card) return false;

  if (meld.type === 'grupo') {
    const testCards = [...meld.cards, card];
    const values = testCards.map(c => c.value);
    const suits = testCards.map(c => c.suit);
    if (new Set(values).size !== 1) return false;
    if (new Set(suits).size !== testCards.length) return false;
    // Para grupos, la posición no importa, así que solo retornamos 'true' si es válido.
    return testCards.length <= 4 ? 'append' : false;
  } 
  
  if (meld.type === 'escalera') {
    // --- INICIO DE LA CORRECCIÓN ---

    // Regla 1: La carta debe ser del mismo palo.
    if (card.suit !== meld.cards[0].suit) {
        return false;
    }

    // Regla 2: La carta no puede ser un duplicado de una ya existente.
    if (meld.cards.some(c => c.value === card.value)) {
        return false;
    }

    // VALIDACIÓN CLAVE: Si una escalera ya contiene un Rey y un As, es una secuencia
    // "cerrada" (ej. Q-K-A) y no se le puede añadir nada más.
    const hasKing = meld.cards.some(c => c.value === 'K');
    const hasAce = meld.cards.some(c => c.value === 'A');
    if (hasKing && hasAce && card.value === '2') {
        return false; // ¡BLOQUEA EL AÑADIDO DE UN '2' A 'Q-K-A'!
    }

    const order = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    // La escalera en la mesa ('meld.cards') ya está ordenada.
    const firstCard = meld.cards[0];
    const lastCard = meld.cards[meld.cards.length - 1];

    const cardRank = order.indexOf(card.value);
    const firstCardRank = order.indexOf(firstCard.value);
    const lastCardRank = order.indexOf(lastCard.value);

    // Comprobar si se puede añadir al final (append)
    if (cardRank === lastCardRank + 1) {
        return 'append';
    }
    // Caso especial: Añadir As al final de una escalera que termina en K
    if (lastCard.value === 'K' && card.value === 'A') {
        return 'append';
    }

    // Comprobar si se puede añadir al principio (prepend)
    if (cardRank === firstCardRank - 1) {
        return 'prepend';
    }
    // Caso especial: Añadir As al principio de una escalera que empieza en 2
    if (firstCard.value === '2' && card.value === 'A') {
        return 'prepend';
    }
    // --- FIN DE LA CORRECCIÓN ---
  }

  return false; // Si ninguna condición se cumple, no se puede añadir.
}

// ▼▼▼ REEMPLAZA LA FUNCIÓN endGameAndCalculateScores ENTERA CON ESTA VERSIÓN ▼▼▼
async function endGameAndCalculateScores(room, winnerSeat, io, abandonmentInfo = null) {
    io.to(room.roomId).emit('playSound', 'victory');
    if (room.isPractice) {
        const humanPlayer = room.seats.find(s => s && !s.isBot);
        if (!humanPlayer) return;
        if (winnerSeat.isBot) {
            io.to(humanPlayer.playerId).emit('practiceGameBotWin', { winnerName: winnerSeat.playerName });
        } else {
            io.to(humanPlayer.playerId).emit('practiceGameHumanWin');
        }
        return;
    }

    if (!room || !winnerSeat || room.state !== 'playing') return;

    if (room.initialSeats) {
        for (const seat of room.initialSeats) {
            if (!seat || seat.playerId === winnerSeat.playerId) continue;
            const finalSeatState = room.seats.find(s => s && s.playerId === seat.playerId);
            if (finalSeatState && finalSeatState.active && !finalSeatState.doneFirstMeld) {
                const penalty = room.settings.penalty || 0;
                const playerInfo = users[finalSeatState.userId];
                if (penalty > 0 && playerInfo) {
                    const penaltyInPlayerCurrency = convertCurrency(penalty, room.settings.betCurrency, playerInfo.currency, exchangeRates);
                    playerInfo.credits -= penaltyInPlayerCurrency;
                    room.pot = (room.pot || 0) + penalty;
                    
                    // ▼▼▼ IMPORTANTE: Guardar la multa en penaltiesPaid para el desglose correcto ▼▼▼
                    if (!room.penaltiesPaid) room.penaltiesPaid = {};
                    room.penaltiesPaid[finalSeatState.userId] = {
                        playerName: finalSeatState.playerName || seat.playerName,
                        amount: parseFloat(penalty), // Usar la multa configurada en el modal
                        reason: 'No bajó los 51 puntos requeridos'
                    };
                    // ▲▲▲ FIN DE GUARDAR EN penaltiesPaid ▲▲▲
                    
                    await updateUserCredits(finalSeatState.userId, playerInfo.credits, playerInfo.currency);
                    io.to(finalSeatState.playerId).emit('userStateUpdated', playerInfo);
                    io.to(room.roomId).emit('potUpdated', { newPotValue: room.pot, isPenalty: true });
                }
            }
        }
    }

    room.state = 'post-game';
    room.lastWinnerId = winnerSeat.playerId;
    room.hostId = winnerSeat.playerId;

    // ▼▼▼ CORRECCIÓN MATEMÁTICA DEFINITIVA ▼▼▼
    
    // 1. Calcular total de apuestas iniciales (Forzando números)
    const betPerPlayer = parseFloat(room.settings.bet) || 0;
    const initialPlayersCount = room.initialSeats ? room.initialSeats.length : 0;
    const totalBets = initialPlayersCount * betPerPlayer;
    
    // 2. Calcular total de multas pagadas (Forzando números en cada suma)
    // Esto asegura que sume 10 + 10 = 20, y no "10" + "10" = "1010"
    const totalPenalties = Object.values(room.penaltiesPaid || {}).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    
    // 3. El Bote Total REAL es la suma de ambos
    const totalPot = totalBets + totalPenalties;
    
    // 4. Actualizamos room.pot
    room.pot = totalPot;

    // 5. Aplicar comisión al BOTE TOTAL RECAUDADO
    const commissionInRoomCurrency = totalPot * 0.10;
    const netWinnings = totalPot - commissionInRoomCurrency;
    
    console.log(`[Fin Partida] Bote: ${totalPot.toFixed(2)} (Apuestas: ${totalBets.toFixed(2)} + Multas: ${totalPenalties.toFixed(2)}). Ganancia Neta: ${netWinnings.toFixed(2)}`);
    // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
    
    // Guardar comisión en el log de administración (solo una vez por partida)
    if (!room.commissionSaved) {
        const commissionInCOP = convertCurrency(commissionInRoomCurrency, room.settings.betCurrency, 'COP', exchangeRates);
        await saveCommission(commissionInCOP, 'COP');
        room.commissionSaved = true; // Marcar que ya se guardó la comisión
    }

    const winnerInfo = users[winnerSeat.userId];
    if (winnerInfo) {
        const winningsInWinnerCurrency = convertCurrency(netWinnings, room.settings.betCurrency, winnerInfo.currency, exchangeRates);
        winnerInfo.credits += winningsInWinnerCurrency;
        await updateUserCredits(winnerSeat.userId, winnerInfo.credits, winnerInfo.currency);
        io.to(winnerSeat.playerId).emit('userStateUpdated', winnerInfo);
    }

    // --- INICIO DE LA MODIFICACIÓN ---
    const bet = room.settings.bet || 0;
    const penalty = room.settings.penalty || 0;
    const currencySymbol = room.settings.betCurrency || 'USD';
    let detailsInfo = [];

    // 1. Añadimos la apuesta del ganador a la lista de detalles.
    detailsInfo.push(`<p><strong style="color:#6bff6b;">${winnerSeat.playerName} (Ganador)</strong> | Aportó apuesta = ${bet.toFixed(2)} ${currencySymbol}</p>`);

    if (room.initialSeats) {
        room.initialSeats.forEach(seat => {
            if (!seat || seat.playerId === winnerSeat.playerId) return;

            const finalSeatState = room.seats.find(s => s && s.playerId === seat.playerId);
            const penaltyInfo = room.penaltiesPaid && room.penaltiesPaid[seat.userId];
            let statusText = '';
            let amountPaid = 0;
            let baseText = 'Pagó apuesta';
            let reasonText = '';
            amountPaid = bet; // La apuesta se descontó al iniciar
            let color = '#ffff00';

            if (!finalSeatState) {
                // Jugador abandonó (incluye inactividad)
                if (penaltyInfo) {
                    // Verificar si la razón es específica de inactividad
                    if (penaltyInfo.reason && (penaltyInfo.reason.includes('inactividad') || penaltyInfo.reason.includes('Abandono'))) {
                        reasonText = 'por abandono por inactividad (multa aplicada)';
                    } else {
                        reasonText = 'por abandonar (multa aplicada)';
                    }
                    baseText = 'Pagó apuesta y multa';
                    amountPaid = bet + penalty;
                    color = '#ff4444';
                } else {
                    reasonText = 'por abandonar';
                    baseText = 'Pagó apuesta';
                    amountPaid = bet;
                    color = '#ffff00';
                }
            } else if (finalSeatState.active === false) {
                // Jugador eliminado por falta (no inactividad)
                if (penaltyInfo) {
                    reasonText = `por falta: ${penaltyInfo.reason}`;
                    baseText = 'Pagó apuesta y multa';
                    amountPaid = bet + penalty;
                    color = '#ff4444';
                } else {
                    reasonText = 'por falta';
                    baseText = 'Pagó apuesta y multa';
                    amountPaid = bet + penalty;
                    color = '#ff4444';
                }
            } else if (!finalSeatState.doneFirstMeld) {
                // Jugador no bajó los 51 puntos
                if (penaltyInfo) {
                    reasonText = `por no bajar (multa aplicada)`;
                    baseText = 'Pagó apuesta y multa';
                    amountPaid = bet + penalty;
                    color = '#ff4444';
                } else {
                    reasonText = 'por no bajar';
                    baseText = 'Pagó apuesta y multa';
                    amountPaid = bet + penalty;
                    color = '#ff4444';
                }
            }

            statusText = `<span style="color:${color};">${baseText} ${reasonText}</span>`.trim();
            detailsInfo.push(`<p>${seat.playerName} | ${statusText} = ${amountPaid.toFixed(2)} ${currencySymbol}</p>`);
        });
    }

    // Calcular desglose del bote (Usando las variables calculadas arriba para consistencia)
    let potBreakdown = '';
    if (totalPenalties > 0) {
        potBreakdown = `<p style="font-size: 0.9rem; color: #c5a56a;"><strong>Desglose del Bote:</strong></p>
                        <p style="font-size: 0.9rem; margin-left: 10px;">• Apuestas iniciales: ${totalBets.toFixed(2)} ${currencySymbol}</p>
                        <p style="font-size: 0.9rem; margin-left: 10px; color: #ff4444;">• Multas aplicadas: +${totalPenalties.toFixed(2)} ${currencySymbol}</p>
                        <p style="font-size: 0.9rem; margin-left: 10px;"><strong>Total recaudado: ${totalPot.toFixed(2)} ${currencySymbol}</strong></p>`;
    }

    let winningsSummary = `<div style="border-top: 1px solid #c5a56a; margin-top: 15px; padding-top: 10px; text-align: left;">
                            ${potBreakdown}
                            <p><strong>Bote Total Recaudado:</strong> ${totalPot.toFixed(2)} ${currencySymbol}</p>
                            <p><strong>Comisión Admin (10%):</strong> -${commissionInRoomCurrency.toFixed(2)} ${currencySymbol}</p>
                            <p style="color: #6bff6b; font-size: 1.2rem;"><strong>GANANCIA NETA: ${netWinnings.toFixed(2)} ${currencySymbol}</strong></p>
                           </div>`;

    const scoresHTML = `<div style="text-align: left;"><p style="color:#c5a56a; font-weight:bold;">Detalle:</p>${detailsInfo.join('')}</div>` + winningsSummary;
    // --- FIN DE LA MODIFICACIÓN ---

    const finalSanitizedState = getSanitizedRoomForClient(room);
    io.to(room.roomId).emit('gameEnd', {
        winnerName: winnerSeat.playerName,
        scoresHTML: scoresHTML,
        finalRoomState: finalSanitizedState,
        abandonment: abandonmentInfo,
        winnerId: winnerSeat.playerId,
        potData: {
            pot: totalPot,
            commission: commissionInRoomCurrency,
            winnings: netWinnings,
            currency: room.settings.betCurrency
        }
    });

    room.rematchRequests.clear();
    broadcastRoomListUpdate(io);
    
    // ▼▼▼ ACTUALIZAR ESTADO DE JUGADORES AL TERMINAR PARTIDA ▼▼▼
    // Actualizar el estado de todos los jugadores de la sala para que regresen al lobby
    if (room.initialSeats) {
        room.initialSeats.forEach(seat => {
            if (seat && seat.playerId) {
                const socket = io.sockets.sockets.get(seat.playerId);
                if (socket && connectedUsers[seat.playerId]) {
                    // Actualizar estado según el lobby actual
                    const currentLobby = connectedUsers[seat.playerId].currentLobby || 'La 51';
                    connectedUsers[seat.playerId].status = `En el lobby de ${currentLobby}`;
                    
                    // Si el jugador no tiene currentLobby, establecerlo según el juego
                    if (!connectedUsers[seat.playerId].currentLobby) {
                        connectedUsers[seat.playerId].currentLobby = 'La 51';
                    }
                }
            }
        });
        // Emitir actualización de lista de usuarios
        broadcastUserListUpdate(io);
    }
    // ▲▲▲ FIN DE ACTUALIZACIÓN DE ESTADO ▲▲▲
}
// ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

// ▼▼▼ REEMPLAZA ESTA FUNCIÓN ▼▼▼
async function checkVictoryCondition(room, roomId, io) {
  if (!room || room.state !== 'playing') return false;

  // La condición AHORA es: ¿a algún jugador le queda CERO cartas DESPUÉS de descartar?
  // Esta función se llamará DESPUÉS de un descarte válido.
  const winnerSeat = room.seats.find(s => s && s.active !== false && room.playerHands[s.playerId]?.length === 0);
  
  if (winnerSeat) {
    console.log(`¡VICTORIA! ${winnerSeat.playerName} ha descartado su última carta y gana la partida.`);
    await endGameAndCalculateScores(room, winnerSeat, io);
    return true; // Se encontró un ganador
  }
  return false; // El juego continúa
}
// ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

// ▼▼▼ REEMPLAZA ESTA FUNCIÓN COMPLETA ▼▼▼
async function handlePlayerElimination(room, faultingPlayerId, faultData, io) {
    if (!room) return;
    io.to(room.roomId).emit('playSound', 'fault');
    const roomId = room.roomId;
    const playerSeat = room.seats.find(s => s && s.playerId === faultingPlayerId);

    const finalFaultData = typeof faultData === 'string' ? { reason: faultData } : faultData;

    // --- INICIO DE LA NUEVA LÓGICA ESPECÍFICA ---
    if (room.isPractice && playerSeat && !playerSeat.isBot) {
        // CASO ESPECIAL: Es una partida de práctica Y la falta la cometió el jugador humano.
        console.log(`[Práctica] Falta del jugador humano. Terminando la partida.`);

        io.to(room.roomId).emit('playSound', 'fault');
        
        // 1. Notificamos al jugador de su eliminación para que vea el modal de la falta.
        io.to(faultingPlayerId).emit('playerEliminated', {
            playerId: faultingPlayerId,
            playerName: playerSeat.playerName,
            faultData: finalFaultData,
            redirect: false, // IMPORTANTE: No sacar de la mesa
            canWatch: true   // IMPORTANTE: Permitir ver el resto del juego
        });
        
        // 2. Enviamos un evento SEPARADO para indicarle al cliente que debe mostrar el modal de reinicio.
        io.to(faultingPlayerId).emit('practiceGameHumanFaultEnd');
        
        // 3. Detenemos la ejecución aquí. La partida para este jugador ha terminado.
        return;
    }
    // --- FIN DE LA NUEVA LÓGICA ---

    if (playerSeat && playerSeat.active) {
        const penalty = room.settings.penalty || 0;
        const playerInfo = users[playerSeat.userId];
        
        if (penalty > 0 && playerInfo) {
            const penaltyInPlayerCurrency = convertCurrency(penalty, room.settings.betCurrency, playerInfo.currency, exchangeRates);
            playerInfo.credits -= penaltyInPlayerCurrency;
            
            // ▼▼▼ LÍNEA AÑADIDA: Guardar en la Base de Datos ▼▼▼
            await updateUserCredits(playerSeat.userId, playerInfo.credits, playerInfo.currency);
            // ▲▲▲ FIN DE LA LÍNEA AÑADIDA ▲▲▲

            room.pot = (room.pot || 0) + penalty;
            
            // Rastrear la multa pagada
            if (!room.penaltiesPaid) room.penaltiesPaid = {};
            room.penaltiesPaid[playerSeat.userId] = {
                playerName: playerSeat.playerName,
                amount: parseFloat(penalty), // IMPORTANTE: Forzar número aquí
                reason: finalFaultData?.reason || 'Falta cometida'
            };
            
            console.log(`[${roomId}] 💰 Multa aplicada: ${penalty} ${room.settings.betCurrency} a ${playerSeat.playerName}. Bote actualizado: ${(room.pot - penalty)} → ${room.pot}`);
            io.to(faultingPlayerId).emit('userStateUpdated', playerInfo);
            io.to(roomId).emit('potUpdated', { newPotValue: room.pot, isPenalty: true });
        }
        
        const playerHand = room.playerHands[faultingPlayerId] || [];
        const turnMeldCards = room.turnMelds.flatMap(meld => meld.cards);
        const cardsToDiscard = [...playerHand, ...turnMeldCards];
        if (cardsToDiscard.length > 0) {
            const topCard = room.discardPile.pop();
            shuffle(cardsToDiscard);
            room.discardPile.unshift(...cardsToDiscard);
            if (topCard) room.discardPile.push(topCard);
        }
        room.playerHands[faultingPlayerId] = [];
        resetTurnState(room);

        playerSeat.active = false;
        // ▼▼▼ CAMBIO AQUÍ ▼▼▼
        io.to(roomId).emit('playerEliminated', {
            playerId: faultingPlayerId,
            playerName: playerSeat.playerName,
            faultData: finalFaultData,
            redirect: false, // IMPORTANTE: No sacar de la mesa
            canWatch: true   // IMPORTANTE: Permitir ver el resto del juego
        });
        // ▲▲▲ FIN DEL CAMBIO ▲▲▲
    }

    const activePlayers = room.seats.filter(s => s && s.active !== false);

    if (activePlayers.length <= 1) {
        const winnerSeat = activePlayers[0];
        if (winnerSeat) {
            await endGameAndCalculateScores(room, winnerSeat, io);
        }
        return;
    }
    
    if (room.currentPlayerId === faultingPlayerId) {
        resetTurnState(room);
        const seatedPlayers = room.seats.filter(s => s !== null);
        const currentPlayerIndex = seatedPlayers.findIndex(p => p.playerId === faultingPlayerId);
        let nextPlayerIndex = (currentPlayerIndex + 1) % seatedPlayers.length;
        let attempts = 0;
        while (!seatedPlayers[nextPlayerIndex] || seatedPlayers[nextPlayerIndex].active === false) {
             nextPlayerIndex = (nextPlayerIndex + 1) % seatedPlayers.length;
             if (++attempts > seatedPlayers.length) {
                 console.log("Error: No se encontró un siguiente jugador activo.");
                 return;
             }
        }
        const nextPlayer = seatedPlayers[nextPlayerIndex];
        room.currentPlayerId = nextPlayer.playerId;
        const playerHandCounts = {};
        seatedPlayers.forEach(p => { playerHandCounts[p.playerId] = room.playerHands[p.playerId]?.length || 0; });

        const nextPlayerSeat = room.seats.find(s => s && s.playerId === room.currentPlayerId);
        if (nextPlayerSeat && nextPlayerSeat.isBot) {
            setTimeout(() => botPlay(room, room.currentPlayerId, io), 1000);
        } else {
            // Iniciar timeout usando la lógica de Ludo (copiada exactamente)
            const newTimeoutKey = `${roomId}_${nextPlayer.userId}`;
            const alreadyPenalized = (room.penaltyApplied && room.penaltyApplied[nextPlayer.userId]);
            if (!alreadyPenalized) {
                // Cancelar TODOS los timeouts posibles antes de iniciar uno nuevo
                if (la51InactivityTimeouts[newTimeoutKey]) {
                    clearTimeout(la51InactivityTimeouts[newTimeoutKey]);
                    delete la51InactivityTimeouts[newTimeoutKey];
                }
                const newTimeoutKeyByPlayerId = `${roomId}_${nextPlayer.playerId}`;
                if (la51InactivityTimeouts[newTimeoutKeyByPlayerId]) {
                    clearTimeout(la51InactivityTimeouts[newTimeoutKeyByPlayerId]);
                    delete la51InactivityTimeouts[newTimeoutKeyByPlayerId];
                }
                Object.keys(la51InactivityTimeouts).forEach(key => {
                    if (key.startsWith(`${roomId}_`) && (key.includes(nextPlayer.userId) || key.includes(nextPlayer.playerId))) {
                        clearTimeout(la51InactivityTimeouts[key]);
                        delete la51InactivityTimeouts[key];
                    }
                });
                // Iniciar timeout
                la51InactivityTimeouts[newTimeoutKey] = setTimeout(() => {
                    const currentRoom = la51Rooms[roomId];
                    if (!currentRoom || currentRoom.currentPlayerId !== nextPlayer.playerId) {
                        const currentSeat = currentRoom.seats.find(s => s && s.userId === nextPlayer.userId);
                        if (!currentSeat || currentRoom.currentPlayerId !== currentSeat.playerId) {
                            delete la51InactivityTimeouts[newTimeoutKey];
                            return;
                        }
                    }
                    const currentSeat = currentRoom.seats.find(s => s && s.userId === nextPlayer.userId);
                    if (!currentSeat || currentSeat.userId !== nextPlayer.userId) {
                        delete la51InactivityTimeouts[newTimeoutKey];
                        return;
                    }
                    if (!currentRoom.penaltyApplied) currentRoom.penaltyApplied = {};
                    currentRoom.penaltyApplied[currentSeat.userId] = true;
                    let playerIdToUse = currentSeat.playerId;
                    if (!playerIdToUse && currentSeat.userId) {
                        for (const [socketId, socket] of io.sockets.sockets.entries()) {
                            const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                            if (socketUserId === currentSeat.userId) {
                                playerIdToUse = socketId;
                                break;
                            }
                        }
                    }
                    if (playerIdToUse) {
                        handlePlayerDeparture(roomId, playerIdToUse, io, true);
                    }
                    delete la51InactivityTimeouts[newTimeoutKey];
                }, LA51_INACTIVITY_TIMEOUT_MS);
            }
        }

        io.to(roomId).emit('turnChanged', {
            discardedCard: null,
            discardingPlayerId: faultingPlayerId,
            newDiscardPile: room.discardPile,
            nextPlayerId: room.currentPlayerId,
            playerHandCounts: playerHandCounts,
            newMelds: room.melds
        });
    }
}
// ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

function getCombinations(arr, size) {
  if (size > arr.length) return [];
  if (size === 0) return [[]];
  if (size === 1) return arr.map(x => [x]);
  const res = [];
  arr.forEach((head, i) => {
    getCombinations(arr.slice(i + 1), size - 1).forEach(t => res.push([head, ...t]));
  });
  return res;
}

function findAndValidateAllMelds(cards) {
    let remainingCards = [...cards];
    const validatedMelds = [];
    let changed = true;

    // Usamos un bucle para encontrar combinaciones repetidamente
    while (changed) {
        changed = false;
        let bestCombo = null;
        let bestType = null;

        // Buscamos desde la combinación más grande posible hacia abajo
        for (let size = Math.min(7, remainingCards.length); size >= 3; size--) {
            for (const combo of getCombinations(remainingCards, size)) {
                const type = validateMeld(combo);
                if (type) {
                    bestCombo = combo;
                    bestType = type;
                    break; // Encontramos una combinación válida, la procesamos
                }
            }
            if (bestCombo) break;
        }

        if (bestCombo) {
            const points = calculateMeldPoints(bestCombo, bestType);
            validatedMelds.push({ cards: bestCombo, type: bestType, points: points });

            // Eliminamos las cartas usadas de la lista para la siguiente iteración
            const comboIds = new Set(bestCombo.map(c => c.id));
            remainingCards = remainingCards.filter(c => !comboIds.has(c.id));
            changed = true; // Como encontramos algo, volvemos a buscar
        }
    }

    // El resultado es válido solo si TODAS las cartas seleccionadas se usaron en combinaciones
    const allCardsAreUsed = remainingCards.length === 0;

    return {
        isValid: allCardsAreUsed && validatedMelds.length > 0,
        melds: validatedMelds,
        totalPoints: validatedMelds.reduce((sum, meld) => sum + meld.points, 0)
    };
}

// ▼▼▼ REEMPLAZA ESTAS DOS FUNCIONES EN SERVER.JS ▼▼▼

// ▼▼▼ FUNCIÓN findOptimalMelds INTELIGENTE (PARA BOTS) ▼▼▼
function findOptimalMelds(hand) {
  let availableCards = [...hand];
  let foundMelds = [];
  let changed = true;

  while (changed) {
    changed = false;
    let bestMeld = null;
    const allPossibleMelds = [];
    
    for (let size = Math.min(7, availableCards.length); size >= 3; size--) {
      for (const combo of getCombinations(availableCards, size)) {
        
        // ¡CAMBIO CLAVE! El bot ahora usa la validación inteligente.
        const validationResult = validateMeldAndCorrect(combo); 
        
        if (validationResult) {
          const { type, cards: orderedCards } = validationResult;
          const points = calculateMeldPoints(orderedCards, type);
          const score = orderedCards.length * 100 + points;
          allPossibleMelds.push({ cards: orderedCards, type, points, score });
        }
      }
    }
    
    if (allPossibleMelds.length > 0) {
      bestMeld = allPossibleMelds.sort((a, b) => b.score - a.score)[0];
      foundMelds.push(bestMeld);
      
      const bestMeldCardIds = new Set(bestMeld.cards.map(c => c.id));
      availableCards = availableCards.filter(card => !bestMeldCardIds.has(card.id));
      changed = true;
    }
  }
  return foundMelds;
}

function findWorstCardToDiscard(hand, allMeldsOnTable) {
  if (hand.length === 0) return null;
  const rankOrder = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const getRank = (c) => rankOrder.indexOf(c.value);

  const scores = hand.map(card => {
    let score = card.points; // Puntuación base
    // Penalización masiva si la carta se puede añadir a un juego existente
    for(const meld of allMeldsOnTable) {
        if(canBeAddedToServerMeld(card, meld)) {
            score -= 1000;
        }
    }
    // Bonificaciones por sinergia con otras cartas en la mano
    for (const otherCard of hand) {
        if (card.id === otherCard.id) continue;
        if (card.value === otherCard.value) score -= 15; // Potencial trío
        if (card.suit === otherCard.suit) {
            const rankDiff = Math.abs(getRank(card) - getRank(otherCard));
            if (rankDiff === 1) score -= 10; // Potencial escalera
            else if (rankDiff === 2) score -= 5;
        }
    }
    return { card, score };
  });
  // Devuelve la carta con la puntuación más alta (la menos útil)
  scores.sort((a, b) => b.score - a.score);
  return scores[0].card;
}

// ▼▼▼ REEMPLAZA LA FUNCIÓN botPlay ENTERA EN SERVER.JS CON ESTA VERSIÓN ▼▼▼
async function botPlay(room, botPlayerId, io) {
    // 1. NUEVA LÍNEA: Verificar si la sala aún existe en el registro global.
    // Si la sala fue eliminada (ej. por salir de práctica), detenemos al bot inmediatamente.
    if (!la51Rooms[room.roomId]) return;
    
    const botSeat = room.seats.find(s => s && s.playerId === botPlayerId);
    if (!botSeat || !botSeat.active) return;

    const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    await pause(1500); // Pausa para simular que piensa

    let botHand = room.playerHands[botPlayerId];
    let source = 'deck';
    let cardDrawn = null;
    let drewFromDiscardPile = false;

    // 1. --- LÓGICA DE ROBO (INTELIGENTE) ---
    const topDiscard = room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null;
    // ▼▼▼ REEMPLAZA ESTA LÍNEA ▼▼▼
    if (botHand.length > 2 && topDiscard) {
    // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
        const canAddToExisting = botSeat.doneFirstMeld && room.melds.some(m => canBeAddedToServerMeld(topDiscard, m));
        const potentialHand = [...botHand, topDiscard];
        const potentialNewMelds = findOptimalMelds(potentialHand);
        const meldsUsingDiscardCard = potentialNewMelds.filter(m => m.cards.some(c => c.id === topDiscard.id));
        let canFormAndMeldNewSet = false;
        if (meldsUsingDiscardCard.length > 0) {
            if (botSeat.doneFirstMeld) {
                canFormAndMeldNewSet = true;
            } else {
                const totalPoints = potentialNewMelds.reduce((sum, meld) => sum + meld.points, 0);
                if (totalPoints >= 51) canFormAndMeldNewSet = true;
            }
        }
        if (canAddToExisting || canFormAndMeldNewSet) {
            cardDrawn = room.discardPile.pop();
            botHand.push(cardDrawn);
            drewFromDiscardPile = true;
            source = 'discard';
        }
    }

    if (!drewFromDiscardPile) {
        if (room.deck.length === 0) {
            if (room.discardPile.length > 1) {
                const topCard = room.discardPile.pop();
                room.deck = room.discardPile;
                shuffle(room.deck);
                room.discardPile = [topCard];
                io.to(room.roomId).emit('deckShuffled');
            } else {
                console.log(`Bot ${botSeat.playerName} no puede robar, no hay cartas.`);
                // Si no puede robar, debe pasar el turno (esto es un caso raro)
                // Aquí podrías implementar la lógica para terminar el juego si no hay más movimientos.
                // Por ahora, simplemente avanzaremos el turno.
                return await advanceTurnAfterAction(room, botPlayerId, null, io);
            }
        }
        cardDrawn = room.deck.shift();
        botHand.push(cardDrawn);
    }

    // LÍNEA CORREGIDA
    io.to(room.roomId).emit('playerDrewCard', {
        playerId: botPlayerId,
        source: source,
        card: source === 'discard' ? cardDrawn : null,
        newDiscardPile: room.discardPile // <-- AÑADE ESTA LÍNEA
    });
    io.to(room.roomId).emit('handCountsUpdate', { playerHandCounts: getSanitizedRoomForClient(room).playerHandCounts });

    await pause(1500);

    // 2. --- LÓGICA PARA AÑADIR A JUEGOS EXISTENTES ---
    if (botSeat.doneFirstMeld) {
        let cardWasAdded = true;
        while (cardWasAdded) {
            cardWasAdded = false;
            let cardToAdd = null, targetMeldIndex = -1, cardHandIndex = -1;
            for (let i = 0; i < botHand.length; i++) {
                for (let j = 0; j < room.melds.length; j++) {
                    if (canBeAddedToServerMeld(botHand[i], room.melds[j])) {
                        cardToAdd = botHand[i];
                        targetMeldIndex = j;
                        cardHandIndex = i;
                        break;
                    }
                }
                if (cardToAdd) break;
            }
            if (cardToAdd) {
                io.to(room.roomId).emit('animateCardAdd', { melderId: botPlayerId, card: cardToAdd, targetMeldIndex: targetMeldIndex });
                io.to(room.roomId).emit('playSound', 'add');
                const addPosition = canBeAddedToServerMeld(cardToAdd, room.melds[targetMeldIndex]);
                if (addPosition === 'prepend') room.melds[targetMeldIndex].cards.unshift(cardToAdd);
                else room.melds[targetMeldIndex].cards.push(cardToAdd);
                botHand.splice(cardHandIndex, 1);
                io.to(room.roomId).emit('meldUpdate', { newMelds: room.melds, turnMelds: [], playerHandCounts: getSanitizedRoomForClient(room).playerHandCounts, highlight: { cardId: cardToAdd.id, meldIndex: targetMeldIndex } });
                cardWasAdded = true;
                if (await checkVictoryCondition(room, room.roomId, io)) return;
                await pause(1500);
            }
        }
    }

    // 3. --- LÓGICA PARA BAJAR NUEVOS JUEGOS ---
    // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AQUÍ ▼▼▼
    // NUEVA REGLA: Si al bot solo le quedan 3 cartas, NO puede bajar un nuevo trío.
    // Esto le obliga a añadir a juegos existentes o a seguir robando hasta poder ganar legalmente.
    if (botHand.length === 3) {
        console.log(`[Bot Logic] ${botSeat.playerName} tiene 3 cartas. Se salta la fase de bajar nuevos juegos para evitar una falta.`);
    } else {
    // ▲▲▲ FIN DEL BLOQUE A AÑADIR (Solo la apertura del 'else') ▲▲▲
    const meldsToPlay = findOptimalMelds(botHand);
    if (meldsToPlay.length > 0) {
        const totalPoints = meldsToPlay.reduce((sum, meld) => sum + meld.points, 0);
        const canMeld = botSeat.doneFirstMeld || totalPoints >= 51;

        if (canMeld) {
            let shouldProceedWithMeld = true;

            // VALIDACIÓN DE REGLA: Si robó del descarte, está OBLIGADO a usar la carta.
            if (drewFromDiscardPile) {
                const discardCardId = cardDrawn.id;
                const isCardUsed = meldsToPlay.some(meld => meld.cards.some(card => card.id === discardCardId));

                if (!isCardUsed) {
                    console.log(`[Bot Logic Fault] ${botSeat.playerName} robó del descarte pero su plan de bajada no incluyó la carta. Saltando fase de bajada.`);
                    shouldProceedWithMeld = false; // No se le permite bajar para no romper las reglas.
                }
            }

            if (shouldProceedWithMeld) {
                // El bot cumple las reglas, procede a bajar las combinaciones.
                io.to(room.roomId).emit('playSound', 'meld');
                const allMeldedCardIds = new Set();

                for (const meld of meldsToPlay) {
                    io.to(room.roomId).emit('animateNewMeld', { melderId: botPlayerId, cards: meld.cards });
                    room.melds.push({ cards: meld.cards, type: meld.type, points: meld.points, melderId: botPlayerId });
                    meld.cards.forEach(c => allMeldedCardIds.add(c.id));
                }

                if (allMeldedCardIds.size > 0) {
                    botHand = botHand.filter(card => !allMeldedCardIds.has(card.id));
                    room.playerHands[botPlayerId] = botHand;
                }

                // ▼▼▼ AÑADE ESTE BLOQUE DE VALIDACIÓN PARA EL BOT AQUÍ ▼▼▼
                if (botHand.length === 0) {
                    const reason = `El bot ${botSeat.playerName} se quedó sin cartas al bajar, cometiendo una falta.`;
                    console.log(`FALTA GRAVE BOT: ${reason}`);
                    return handlePlayerElimination(room, botPlayerId, reason, io);
                }
                // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

                botSeat.doneFirstMeld = true;
                io.to(room.roomId).emit('meldUpdate', { newMelds: room.melds, turnMelds: [], playerHandCounts: getSanitizedRoomForClient(room).playerHandCounts });
                if (await checkVictoryCondition(room, room.roomId, io)) return;
                await pause(1500);
            }
        }
    }
    // ▼▼▼ AÑADE ESTA LLAVE DE CIERRE '}' AL FINAL DE LA SECCIÓN 3 ▼▼▼
    } 
    // ▲▲▲ FIN DE LA LLAVE A AÑADIR ▲▲▲

    // 4. --- LÓGICA DE DESCARTE (INTELIGENTE) ---
    if (botHand.length > 0) {
        const cardToDiscard = findWorstCardToDiscard(botHand, room.melds);

        // ▼▼▼ REEMPLAZA ESTE BLOQUE ▼▼▼
        // VALIDACIÓN DE FALTA: Comprobamos si el descarte del bot es ilegal.
        // ESTA REGLA SE OMITE SI ES LA ÚLTIMA CARTA PARA GANAR.
        if (botHand.length > 1 && cardToDiscard) {
            for (const meld of room.melds) {
                if (canBeAddedToServerMeld(cardToDiscard, meld)) {
                    const reason = `Descarte ilegal del bot. La carta ${cardToDiscard.value}${getSuitIcon(cardToDiscard.suit)} se podía añadir a un juego en mesa.`;
                    console.log(`FALTA GRAVE BOT: ${botSeat.playerName} - ${reason}`);
                    // Si es ilegal, eliminamos al bot y detenemos su turno.
                    return handlePlayerElimination(room, botPlayerId, reason, io);
                }
            }
        }
        // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲
        // ▲▲▲ FIN DEL BLOQUE DE VALIDACIÓN ▲▲▲

        if (cardToDiscard) {
            const cardIndex = botHand.findIndex(c => c.id === cardToDiscard.id);
            if (cardIndex !== -1) {
                const [discardedCard] = botHand.splice(cardIndex, 1);
                room.discardPile.push(discardedCard);
                await advanceTurnAfterAction(room, botPlayerId, discardedCard, io);
            }
        } else { // Fallback por si algo falla
            const [discardedCard] = botHand.splice(0, 1);
            room.discardPile.push(discardedCard);
            await advanceTurnAfterAction(room, botPlayerId, discardedCard, io);
        }
    }
}

async function advanceTurnAfterAction(room, discardingPlayerId, discardedCard, io) {
    if (await checkVictoryCondition(room, room.roomId, io)) return;

    resetTurnState(room);
    const seatedPlayers = room.seats.filter(s => s !== null);
    const currentPlayerIndex = seatedPlayers.findIndex(p => p.playerId === discardingPlayerId);
    let nextPlayerIndex = (currentPlayerIndex + 1) % seatedPlayers.length;
    let attempts = 0;
    while (!seatedPlayers[nextPlayerIndex] || seatedPlayers[nextPlayerIndex].active === false) {
        nextPlayerIndex = (nextPlayerIndex + 1) % seatedPlayers.length;
        if (++attempts > seatedPlayers.length * 2) {
            console.log("Error: No se pudo encontrar un siguiente jugador activo.");
            return;
        }
    }
    const nextPlayer = seatedPlayers[nextPlayerIndex];
    room.currentPlayerId = nextPlayer.playerId;

    const nextPlayerSeat = room.seats.find(s => s && s.playerId === room.currentPlayerId);
    console.log(`[${room.roomId}] [TURN CHANGE] Turno cambiado a ${nextPlayer.playerName} (${room.currentPlayerId}). Es bot: ${nextPlayerSeat?.isBot || false}`);
    
    // ▼▼▼ TIMEOUT DE INACTIVIDAD: Copiado EXACTAMENTE de ludoPassTurn ▼▼▼
    // Cancelar timeout anterior si existe
    const previousSeat = room.seats.find(s => s && s.playerId === discardingPlayerId);
    const previousTimeoutKey = `${room.roomId}_${previousSeat?.playerId}`;
    if (la51InactivityTimeouts[previousTimeoutKey]) {
        clearTimeout(la51InactivityTimeouts[previousTimeoutKey]);
        delete la51InactivityTimeouts[previousTimeoutKey];
        console.log(`[${room.roomId}] Timeout de inactividad cancelado para el jugador anterior`);
    }
    
    // ▼▼▼ CRÍTICO: Verificar si el jugador ya fue eliminado antes de iniciar timeout ▼▼▼
    // Si el jugador ya fue penalizado, significa que ya fue eliminado, no iniciar timeout
    const globalPenaltyKey = `${room.roomId}_${nextPlayer.userId}`;
    const alreadyPenalized = (room.penaltyApplied && room.penaltyApplied[nextPlayer.userId]);
    
    if (alreadyPenalized) {
        console.log(`[${room.roomId}] ⚠️ El jugador ${nextPlayer.playerName} ya fue eliminado y penalizado. NO se inicia timeout de inactividad.`);
        // No iniciar timeout si ya fue eliminado
        // Continuar con el flujo normal del turno
    }
    // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    // NOTA: NO verificamos si el jugador está "desconectado" - el jugador puede reconectarse en cualquier momento antes del timeout y continuar jugando
    
    if (nextPlayerSeat && nextPlayerSeat.isBot) {
        console.log(`[${room.roomId}] [TURN CHANGE] Jugador es bot, iniciando botPlay...`);
        setTimeout(() => botPlay(room, room.currentPlayerId, io), 1000);
    } else {
        // Iniciar timeout de inactividad para el nuevo jugador SOLO si NO fue eliminado
        // ▼▼▼ CRÍTICO: Usar userId en lugar de playerId para consistencia y cancelar TODOS los timeouts posibles ▼▼▼
        const newTimeoutKey = `${room.roomId}_${nextPlayer.userId}`;
        
        // Cancelar TODOS los timeouts posibles antes de iniciar uno nuevo (para asegurar que siempre se espere 2 minutos completos)
        if (la51InactivityTimeouts[newTimeoutKey]) {
            clearTimeout(la51InactivityTimeouts[newTimeoutKey]);
            delete la51InactivityTimeouts[newTimeoutKey];
            console.log(`[${room.roomId}] Timeout anterior cancelado para ${nextPlayer.playerName} (userId: ${nextPlayer.userId})`);
        }
        const newTimeoutKeyByPlayerId = `${room.roomId}_${nextPlayer.playerId}`;
        if (la51InactivityTimeouts[newTimeoutKeyByPlayerId]) {
            clearTimeout(la51InactivityTimeouts[newTimeoutKeyByPlayerId]);
            delete la51InactivityTimeouts[newTimeoutKeyByPlayerId];
            console.log(`[${room.roomId}] Timeout anterior cancelado para ${nextPlayer.playerName} (playerId: ${nextPlayer.playerId})`);
        }
        // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
        Object.keys(la51InactivityTimeouts).forEach(key => {
            if (key.startsWith(`${room.roomId}_`) && (key.includes(nextPlayer.userId) || key.includes(nextPlayer.playerId))) {
                clearTimeout(la51InactivityTimeouts[key]);
                delete la51InactivityTimeouts[key];
                console.log(`[${room.roomId}] Timeout adicional cancelado: ${key}`);
            }
        });
        // ▲▲▲ FIN CANCELACIÓN DE TODOS LOS TIMEOUTS ▲▲▲
        
        // Solo iniciar timeout si el jugador NO fue eliminado
        if (!alreadyPenalized) {
            la51InactivityTimeouts[newTimeoutKey] = setTimeout(() => {
                console.log(`[${room.roomId}] ⏰ TIMEOUT DE INACTIVIDAD: El jugador ${nextPlayer.playerName} no hizo nada en 2 minutos. Eliminando por falta.`);
                
                // Verificar que el turno todavía es de este jugador
                const currentRoom = la51Rooms[room.roomId];
                if (!currentRoom || currentRoom.currentPlayerId !== nextPlayer.playerId) {
                    // Verificar por userId también
                    const currentSeat = currentRoom.seats.find(s => s && s.userId === nextPlayer.userId);
                    if (!currentSeat || currentRoom.currentPlayerId !== currentSeat.playerId) {
                        console.log(`[${room.roomId}] El turno ya cambió. No se elimina al jugador por inactividad.`);
                        delete la51InactivityTimeouts[newTimeoutKey];
                        return;
                    }
                }
                
                // Verificar que el jugador todavía está en la sala (usar userId en lugar de playerId porque puede estar desconectado)
                const currentSeat = currentRoom.seats.find(s => s && s.userId === nextPlayer.userId);
                if (!currentSeat) {
                    console.log(`[${room.roomId}] El asiento ya está vacío. No se elimina por inactividad.`);
                    delete la51InactivityTimeouts[newTimeoutKey];
                    return;
                }
                
                // Verificar que es el mismo jugador por userId (no por playerId, porque puede estar desconectado)
                if (!currentSeat.userId || currentSeat.userId !== nextPlayer.userId) {
                    console.log(`[${room.roomId}] El jugador en el asiento ya no es el mismo. No se elimina por inactividad.`);
                    delete la51InactivityTimeouts[newTimeoutKey];
                    return;
                }
                
                // ▼▼▼ CRÍTICO: REGISTRAR EN penaltyApplied ANTES DE ELIMINAR ▼▼▼
                if (!currentRoom.penaltyApplied) {
                    currentRoom.penaltyApplied = {};
                }
                currentRoom.penaltyApplied[currentSeat.userId] = true;
                console.log(`[${room.roomId}] ✅ Jugador ${currentSeat.playerName} registrado en penaltyApplied para evitar que se reactive el timeout.`);
                // ▲▲▲ FIN DE REGISTRO DE PENALIZACIÓN ▲▲▲
                
                // Eliminar al jugador por inactividad - usar el playerId actual del asiento (puede ser null si está desconectado, pero handlePlayerDeparture lo manejará)
                console.log(`[${room.roomId}] 🚨 ELIMINANDO JUGADOR POR INACTIVIDAD: ${currentSeat.playerName} (userId: ${currentSeat.userId})`);
                
                // Buscar el playerId actual del asiento, o usar cualquier socket del userId si está desconectado
                let playerIdToUse = currentSeat.playerId;
                if (!playerIdToUse && currentSeat.userId) {
                    // Si no hay playerId (jugador desconectado), buscar cualquier socket del userId
                    for (const [socketId, socket] of io.sockets.sockets.entries()) {
                        const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                        if (socketUserId === currentSeat.userId) {
                            playerIdToUse = socketId;
                            break;
                        }
                    }
                }
                
                // Si encontramos un playerId, usarlo; si no, buscar el asiento por userId en handlePlayerDeparture
                if (playerIdToUse) {
                    handlePlayerDeparture(room.roomId, playerIdToUse, io, true); // true = isInactivityTimeout
                } else {
                    // Si no hay playerId, buscar el asiento por userId directamente
                    const seatIndexByUserId = currentRoom.seats.findIndex(s => s && s.userId === currentSeat.userId);
                    if (seatIndexByUserId !== -1) {
                        // Usar el playerId del asiento encontrado, o un valor dummy que handlePlayerDeparture manejará
                        const seatToEliminate = currentRoom.seats[seatIndexByUserId];
                        if (seatToEliminate && seatToEliminate.playerId) {
                            handlePlayerDeparture(room.roomId, seatToEliminate.playerId, io, true);
                        } else {
                            // Si no hay playerId, eliminar directamente el asiento
                            console.log(`[${room.roomId}] ⚠️ Jugador ${currentSeat.playerName} está desconectado sin socket. Eliminando asiento directamente.`);
                            currentRoom.seats[seatIndexByUserId] = null;
                            currentRoom.seats[seatIndexByUserId].active = false;
                            // Pasar el turno si era su turno
                            if (currentRoom.currentPlayerId === currentSeat.playerId) {
                                // Buscar siguiente jugador activo
                                const activeSeats = currentRoom.seats.filter(s => s && s.active !== false);
                                if (activeSeats.length > 1) {
                                    const currentIndex = currentRoom.seats.findIndex(s => s && s.playerId === currentRoom.currentPlayerId);
                                    let nextIndex = (currentIndex + 1) % currentRoom.seats.length;
                                    let attempts = 0;
                                    while (attempts < currentRoom.seats.length * 2) {
                                        const nextSeat = currentRoom.seats[nextIndex];
                                        if (nextSeat && nextSeat.active !== false) {
                                            currentRoom.currentPlayerId = nextSeat.playerId;
                                            // Iniciar timeout para el nuevo jugador
                                            const nextTimeoutKey = `${room.roomId}_${nextSeat.userId}`;
                                            if (!la51InactivityTimeouts[nextTimeoutKey] && !nextSeat.isBot) {
                                                la51InactivityTimeouts[nextTimeoutKey] = setTimeout(() => {
                                                    // Lógica de timeout para el nuevo jugador (similar a la de arriba)
                                                }, LA51_INACTIVITY_TIMEOUT_MS);
                                            }
                                            break;
                                        }
                                        nextIndex = (nextIndex + 1) % currentRoom.seats.length;
                                        attempts++;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Limpiar el timeout y el estado de desconexión
                delete la51InactivityTimeouts[newTimeoutKey];
                // También limpiar por playerId por si acaso
                const timeoutKeyByPlayerId = `${room.roomId}_${nextPlayer.playerId}`;
                if (la51InactivityTimeouts[timeoutKeyByPlayerId]) {
                    delete la51InactivityTimeouts[timeoutKeyByPlayerId];
                }
            }, LA51_INACTIVITY_TIMEOUT_MS);
            
            if (!alreadyPenalized) {
                console.log(`[${room.roomId}] ⏰ Timeout de inactividad iniciado para ${nextPlayer.playerName} (userId: ${nextPlayer.userId}). Si no actúa en ${LA51_INACTIVITY_TIMEOUT_MS/1000} segundos, será eliminado.`);
            }
        }
        // ▲▲▲ FIN TIMEOUT DE INACTIVIDAD (COPIADO DE LUDO) ▲▲▲
    }

    io.to(room.roomId).emit('turnChanged', {
        discardedCard: discardedCard,
        discardingPlayerId: discardingPlayerId,
        newDiscardPile: room.discardPile,
        nextPlayerId: room.currentPlayerId,
        playerHandCounts: getSanitizedRoomForClient(room).playerHandCounts,
        newMelds: room.melds
    });
}

// Configuración de archivos estáticos ya definida arriba

// ▼▼▼ AÑADE ESTA FUNCIÓN COMPLETA ▼▼▼
// ▼▼▼ REEMPLAZA LA FUNCIÓN handlePlayerDeparture ENTERA CON ESTA VERSIÓN ▼▼▼
async function handlePlayerDeparture(roomId, leavingPlayerId, io, isInactivityTimeout = false) {
    console.log(`[DEBUG handlePlayerDeparture] 🔍 INICIO - roomId: ${roomId}, leavingPlayerId: ${leavingPlayerId}, isInactivityTimeout: ${isInactivityTimeout}`);
    try {
        const stackTrace = new Error().stack;
        if (stackTrace) {
            console.log(`[DEBUG handlePlayerDeparture] 🔍 Stack trace:\n${stackTrace}`);
        }
    } catch (err) {
        console.log(`[DEBUG handlePlayerDeparture] 🔍 Stack trace no disponible`);
    }
    const room = la51Rooms[roomId];

    // Cancelar timeout de inactividad: el jugador está saliendo (igual que en Ludo)
    const timeoutKeyByPlayerIdCancel = `${roomId}_${leavingPlayerId}`;
    if (la51InactivityTimeouts[timeoutKeyByPlayerIdCancel]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerIdCancel]);
        delete la51InactivityTimeouts[timeoutKeyByPlayerIdCancel];
    }
    const leavingUserIdCancel = leavingPlayerSeat?.userId;
    if (leavingUserIdCancel) {
        const timeoutKeyByUserIdCancel2 = `${roomId}_${leavingUserIdCancel}`;
        if (la51InactivityTimeouts[timeoutKeyByUserIdCancel2]) {
            clearTimeout(la51InactivityTimeouts[timeoutKeyByUserIdCancel2]);
            delete la51InactivityTimeouts[timeoutKeyByUserIdCancel2];
        }
    }
    Object.keys(la51InactivityTimeouts).forEach(key => {
        if (key.startsWith(`${roomId}_`) && (key.includes(leavingPlayerId) || (leavingUserIdCancel && key.includes(leavingUserIdCancel)))) {
            clearTimeout(la51InactivityTimeouts[key]);
            delete la51InactivityTimeouts[key];
        }
    });


    // ▼▼▼ BLOQUE MODIFICADO: Salida SILENCIOSA y DESTRUCTIVA de Práctica ▼▼▼
    if (room && room.isPractice) {
        console.log(`[Práctica] El jugador humano sale. Eliminando mesa ${roomId} INMEDIATAMENTE.`);
        
        // 1. Cancelar cualquier timeout activo (igual que en Ludo)
        const timeoutKeyByPlayerIdPractice = `${roomId}_${leavingPlayerId}`;
        const timeoutKeyByUserIdPractice = leavingUserId ? `${roomId}_${leavingUserId}` : null;
        if (la51InactivityTimeouts[timeoutKeyByPlayerIdPractice]) {
            clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerIdPractice]);
            delete la51InactivityTimeouts[timeoutKeyByPlayerIdPractice];
        }
        if (timeoutKeyByUserIdPractice && la51InactivityTimeouts[timeoutKeyByUserIdPractice]) {
            clearTimeout(la51InactivityTimeouts[timeoutKeyByUserIdPractice]);
            delete la51InactivityTimeouts[timeoutKeyByUserIdPractice];
        }
        Object.keys(la51InactivityTimeouts).forEach(key => {
            if (key.startsWith(`${roomId}_`) && (key.includes(leavingPlayerId) || (leavingUserId && key.includes(leavingUserId)))) {
                clearTimeout(la51InactivityTimeouts[key]);
                delete la51InactivityTimeouts[key];
            }
        });
        
        // 2. Limpiar referencia en el socket del jugador
        // ▼▼▼ CRÍTICO: NO hacer socket.leave si es timeout de inactividad - el socket ya está desconectado y el timeout se encargará de todo ▼▼▼
        const leavingSocket = io.sockets.sockets.get(leavingPlayerId);
        if (leavingSocket) {
            delete leavingSocket.currentRoomId;
            // ▼▼▼ CRÍTICO: NO hacer socket.leave si es timeout de inactividad ▼▼▼
            // Si es timeout de inactividad, el socket ya está desconectado y el timeout se encargará de todo
            // NO hacer socket.leave porque esto podría causar que el cliente se desconecte prematuramente
            if (!isInactivityTimeout) {
            // Forzar salida de la sala de socket.io inmediatamente
            leavingSocket.leave(roomId);
            } else {
                console.log(`[DEBUG handlePlayerDeparture] ⚠️⚠️⚠️ NO haciendo socket.leave porque isInactivityTimeout es true - el socket ya está desconectado y el timeout se encargará de todo`);
            }
            // ▲▲▲ FIN: NO hacer socket.leave si es timeout de inactividad ▲▲▲
        }
        
        // 3. Eliminar la sala de la memoria global
        delete la51Rooms[roomId]; 
        
        // 4. Notificar actualización de lista de mesas al lobby (para que desaparezca visualmente)
        broadcastRoomListUpdate(io); 
        
        // 5. Actualizar estado visual del usuario a "En el Lobby"
        if (connectedUsers[leavingPlayerId]) {
            const currentLobby = connectedUsers[leavingPlayerId].currentLobby;
            connectedUsers[leavingPlayerId].status = currentLobby ? `En el lobby de ${currentLobby}` : 'En el Lobby';
            broadcastUserListUpdate(io);
        }
        
        // 6. LIMPIEZA DEPREDADORA DE SOCKET (Para asegurar que createRoom no falle después)
        // ▼▼▼ CRÍTICO: NO hacer socket.leave si es timeout de inactividad - el socket ya está desconectado y el timeout se encargará de todo ▼▼▼
        if (leavingSocket && leavingSocket.rooms && !isInactivityTimeout) {
            // Iteramos sobre las salas del socket y lo sacamos de cualquier cosa que parezca una práctica
            for (const r of Array.from(leavingSocket.rooms)) {
                if (r !== leavingSocket.id && (r.startsWith('practice-') || r === roomId)) {
                    leavingSocket.leave(r);
                }
            }
        }
        // ▲▲▲ FIN: NO hacer socket.leave si es timeout de inactividad ▲▲▲
        
        // IMPORTANTE: NO emitimos 'playerEliminated' ni 'gameEnded'. 
        // Simplemente dejamos que el cliente vuelva al lobby por su propia acción de clic.
        return; 
    }
    // ▲▲▲ FIN DEL BLOQUE MODIFICADO ▲▲▲

    if (!room) return;

    console.log(`Gestionando salida del jugador ${leavingPlayerId} de la sala ${roomId}.`);

    if (room.spectators) {
        room.spectators = room.spectators.filter(s => s.id !== leavingPlayerId);
    }

    const seatIndex = room.seats.findIndex(s => s && s.playerId === leavingPlayerId);
    if (seatIndex === -1) {
        io.to(roomId).emit('spectatorListUpdated', { spectators: room.spectators });
        checkAndCleanRoom(roomId, io);
        return;
    }
    
    const leavingPlayerSeat = { ...room.seats[seatIndex] };
    const playerName = leavingPlayerSeat.playerName;
    const wasActive = leavingPlayerSeat.active === true && leavingPlayerSeat.status !== 'waiting';
    const leavingUserId = leavingPlayerSeat.userId; // Guardar userId antes de eliminar

    // ▼▼▼ LIMPIEZA AGRESIVA DE REGISTROS DEL JUGADOR ▼▼▼
    // 1. Marcar como inactivo primero (antes de liberar el asiento para que la lógica de turno funcione)
    leavingPlayerSeat.active = false; // Marcar como inactivo
    
    // 2. Liberar el asiento DESPUÉS de procesar la eliminación (se hará al final si es necesario)
    // NO liberar aquí todavía si el juego está activo, se liberará después de pasar el turno
    
    // 2. Limpiar referencia en el socket del jugador (igual que Ludo)
    // ▼▼▼ CRÍTICO: NO hacer socket.leave si es timeout de inactividad - el socket ya está desconectado y el timeout se encargará de todo ▼▼▼
    const leavingSocket = io.sockets.sockets.get(leavingPlayerId);
    if (leavingSocket) {
        if (leavingSocket.currentRoomId === roomId) {
            delete leavingSocket.currentRoomId;
            console.log(`[${roomId}] ✅ socket.currentRoomId eliminado para ${leavingPlayerId}`);
        }
        
        // ▼▼▼ CRÍTICO: NO hacer socket.leave si es timeout de inactividad ▼▼▼
        // Si es timeout de inactividad, el socket ya está desconectado y el timeout se encargará de todo
        // NO hacer socket.leave porque esto podría causar que el cliente se desconecte prematuramente
        if (!isInactivityTimeout) {
            console.log(`[DEBUG handlePlayerDeparture] ⚠️⚠️⚠️ HACIENDO socket.leave - roomId: ${roomId}, leavingPlayerId: ${leavingPlayerId}, isInactivityTimeout: ${isInactivityTimeout}`);
            try {
                const stackTrace = new Error().stack;
                if (stackTrace) {
                    console.log(`[DEBUG handlePlayerDeparture] ⚠️⚠️⚠️ Stack trace:\n${stackTrace}`);
                }
            } catch (err) {
                console.log(`[DEBUG handlePlayerDeparture] ⚠️⚠️⚠️ Stack trace no disponible`);
            }
        leavingSocket.leave(roomId);
        console.log(`[${roomId}] ✅ Socket ${leavingPlayerId} salió de la sala de socket.io`);
        
        if (leavingSocket.rooms) {
            for (const r of Array.from(leavingSocket.rooms)) {
                if (r !== leavingSocket.id && (r === roomId || r.startsWith('practice-'))) {
                    leavingSocket.leave(r);
                }
            }
        }
        } else {
            console.log(`[DEBUG handlePlayerDeparture] ⚠️⚠️⚠️ NO haciendo socket.leave porque isInactivityTimeout es true - el socket ya está desconectado y el timeout se encargará de todo`);
        }
        // ▲▲▲ FIN: NO hacer socket.leave si es timeout de inactividad ▲▲▲
    }
    
    // 3. Limpiar de initialSeats si existe
    if (room.initialSeats) {
        const initialSeatIndex = room.initialSeats.findIndex(s => s && s.playerId === leavingPlayerId);
        if (initialSeatIndex !== -1) {
            room.initialSeats[initialSeatIndex] = null;
        }
    }
    
    // 4. Limpiar de playerHands si existe (ELIMINAR TODAS LAS CARTAS)
    if (room.playerHands && room.playerHands[leavingPlayerId]) {
        console.log(`[${roomId}] ✅ Eliminando ${room.playerHands[leavingPlayerId].length} cartas del jugador ${playerName}`);
        delete room.playerHands[leavingPlayerId];
    }
    
    // 5. Limpiar de rematchRequests si existe
    if (room.rematchRequests && room.rematchRequests.has(leavingPlayerId)) {
        room.rematchRequests.delete(leavingPlayerId);
        console.log(`[${roomId}] ✅ Eliminando solicitud de revancha del jugador ${playerName}`);
    }
    
    // 6. Limpiar de penaltiesPaid si existe (para permitir reingreso como nuevo)
    if (room.penaltiesPaid && room.penaltiesPaid[leavingUserId]) {
        // NO eliminar aquí, se necesita para el cálculo final del bote
        // Pero se limpiará cuando el jugador regrese como nuevo
        console.log(`[${roomId}] ⚠️ penaltiesPaid conservado para cálculo de bote: ${playerName}`);
    }
    
    // 7. Limpiar desconexiones si existe (ya no se usa, pero por si acaso)
    const disconnectKey = `${roomId}_${leavingUserId}`;
    if (la51DisconnectedPlayers && la51DisconnectedPlayers[disconnectKey]) {
        delete la51DisconnectedPlayers[disconnectKey];
        console.log(`[${roomId}] ✅ Limpiando la51DisconnectedPlayers del usuario ${leavingUserId}`);
    }
    
    // 8. Cancelar cualquier timeout de inactividad pendiente (igual que en Ludo)
    const timeoutKeyByPlayerIdCleanup = `${roomId}_${leavingPlayerId}`;
    const timeoutKeyByUserIdCleanup = leavingUserId ? `${roomId}_${leavingUserId}` : null;
    if (la51InactivityTimeouts[timeoutKeyByPlayerIdCleanup]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerIdCleanup]);
        delete la51InactivityTimeouts[timeoutKeyByPlayerIdCleanup];
    }
    if (timeoutKeyByUserIdCleanup && la51InactivityTimeouts[timeoutKeyByUserIdCleanup]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByUserIdCleanup]);
        delete la51InactivityTimeouts[timeoutKeyByUserIdCleanup];
    }
    // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
    Object.keys(la51InactivityTimeouts).forEach(key => {
        if (key.startsWith(`${roomId}_`) && (key.includes(leavingPlayerId) || (leavingUserId && key.includes(leavingUserId)))) {
            clearTimeout(la51InactivityTimeouts[key]);
            delete la51InactivityTimeouts[key];
        }
    });
    // ▲▲▲ FIN DE LIMPIEZA AGRESIVA ▲▲▲

    if (room.state === 'playing') {
        // VALIDACIÓN CLAVE: Solo aplicamos lógica de abandono si el jugador estaba ACTIVO.
        if (wasActive) {
            // --- JUGADOR ACTIVO: Se aplica multa y se gestiona el turno (igual que abandono voluntario) ---
            const abandonmentReason = `${playerName} ha abandonado la partida.`;
            console.log(`[${roomId}] 🚨 Jugador activo ${playerName} ha abandonado. Aplicando multa y registrando eliminación.`);

            // ▼▼▼ CRÍTICO: REGISTRAR EN LISTA DE ELIMINADOS ANTES DE ENVIAR EVENTO ▼▼▼
            // Esto permite que si el jugador regresa, se le muestre el modal
            const eliminatedKey = `${roomId}_${leavingUserId}`;
            const penaltyAmount = room.settings.penalty || 0;
            
            la51EliminatedPlayers[eliminatedKey] = {
                playerName: playerName,
                reason: 'Abandono / Inactividad',
                faultData: { reason: abandonmentReason },
                penaltyInfo: { amount: penaltyAmount, reason: 'Abandono' },
                timestamp: Date.now()
            };
            console.log(`[${roomId}] ✅ Jugador ${playerName} registrado en la51EliminatedPlayers para mostrar modal si regresa.`);
            // ▲▲▲ FIN DE REGISTRO ▲▲▲

            const reason = abandonmentReason;
            
            // ▼▼▼ CRÍTICO: Si es eliminación por inactividad, usar evento inactivityTimeout ▼▼▼
            if (isInactivityTimeout) {
                // Enviar a los demás jugadores (sin redirect) para que solo vean la notificación
                io.to(roomId).except(leavingPlayerId).emit('playerEliminated', {
                playerId: leavingPlayerId,
                playerName: playerName,
                reason: reason,
                faultData: { reason: abandonmentReason },
                    redirect: false, // NO redirigir a los demás jugadores
                penaltyInfo: { amount: penaltyAmount, reason: 'Abandono' }
            });
            
                // Enviar SOLO al jugador eliminado el evento inactivityTimeout para mostrar modal en el lobby
                const leavingUserIdForEvent = leavingPlayerSeat.userId;
                let leavingSocket = io.sockets.sockets.get(leavingPlayerId);
                
                // Si no se encuentra el socket por playerId, buscar por userId
                if (!leavingSocket && leavingUserId) {
                    for (const [socketId, socket] of io.sockets.sockets.entries()) {
                        const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                        if (socketUserId === leavingUserId) {
                            leavingSocket = socket;
                            console.log(`[${roomId}] ✅ Socket encontrado por userId ${leavingUserId} -> ${socketId}`);
                            break;
                        }
                    }
                }
                
                if (leavingSocket) {
                    // Obtener información del usuario para enviarla en el evento
                    const userInfo = leavingUserId ? users[leavingUserId] : null;
                    const realUsername = userInfo ? userInfo.username : playerName;
                    
                    // ▼▼▼ CRÍTICO: Actualizar connectedUsers ANTES de emitir el evento (solo si el socket está conectado) ▼▼▼
                    // Asegurar que el nombre y estado se actualicen correctamente
                    // IMPORTANTE: Solo actualizar si el socket está realmente conectado, no si está desconectado
                    if (leavingSocket.connected && connectedUsers[leavingSocket.id]) {
                        connectedUsers[leavingSocket.id].username = realUsername;
                        connectedUsers[leavingSocket.id].status = 'En el lobby de La 51';
                        connectedUsers[leavingSocket.id].currentLobby = 'La 51';
                        console.log(`[${roomId}] ✅ connectedUsers actualizado para ${realUsername} (socket: ${leavingSocket.id})`);
                    } else if (leavingSocket.connected && !connectedUsers[leavingSocket.id]) {
                        connectedUsers[leavingSocket.id] = {
                            username: realUsername,
                            status: 'En el lobby de La 51',
                            currentLobby: 'La 51'
                        };
                        console.log(`[${roomId}] ✅ connectedUsers creado para ${realUsername} (socket: ${leavingSocket.id})`);
                    } else {
                        console.log(`[${roomId}] ⚠️ Socket ${leavingSocket.id} no está conectado. NO se actualiza connectedUsers. El timeout se encargará de eso.`);
                    }
                    // ▲▲▲ FIN DE ACTUALIZACIÓN DE CONNECTEDUSERS ▲▲▲
                    
                    // ▼▼▼ CRÍTICO: Solo emitir inactivityTimeout si el socket está conectado ▼▼▼
                    if (leavingSocket.connected) {
                        leavingSocket.emit('inactivityTimeout', {
                            playerId: leavingPlayerId,
                            playerName: playerName,
                            userId: leavingUserId,
                            username: realUsername,
                            avatar: userInfo ? userInfo.avatar : null,
                            userCurrency: userInfo ? userInfo.currency : 'USD',
                            message: 'Has sido eliminado de la mesa por falta de inactividad por 2 minutos.',
                            reason: 'inactivity',
                            redirect: true,
                            forceExit: true
                        });
                        console.log(`[${roomId}] ✅ Evento inactivityTimeout enviado SOLO a ${playerName} (${leavingPlayerId}) para mostrar modal en el lobby. Los demás jugadores recibieron playerEliminated con redirect: false`);
                        
                        // ▼▼▼ CRÍTICO: Actualizar la lista de usuarios inmediatamente después de emitir el evento ▼▼▼
                        broadcastUserListUpdate(io);
                        console.log(`[${roomId}] ✅ Lista de usuarios actualizada después de eliminación por inactividad`);
                        // ▲▲▲ FIN DE ACTUALIZACIÓN DE LISTA ▲▲▲
                    } else {
                        console.log(`[${roomId}] ⚠️ Socket ${leavingPlayerId} no está conectado. NO se envía inactivityTimeout. El jugador recibirá el evento cuando se reconecte.`);
                    }
                    // ▲▲▲ FIN: Solo emitir inactivityTimeout si el socket está conectado ▲▲▲
                } else {
                    console.warn(`[${roomId}] ⚠️ No se encontró socket para ${playerName} (${leavingPlayerId}), pero se actualizará connectedUsers si existe`);
                    // Intentar actualizar connectedUsers de todas formas si existe alguna entrada
                    if (leavingUserId) {
                        for (const [socketId, userData] of Object.entries(connectedUsers)) {
                            if (userData.username === playerName || (socketId.includes(leavingUserId) && userData.username)) {
                                const realUsername = users[leavingUserId]?.username || playerName;
                                connectedUsers[socketId].username = realUsername;
                                connectedUsers[socketId].status = 'En el lobby de La 51';
                                connectedUsers[socketId].currentLobby = 'La 51';
                                broadcastUserListUpdate(io);
                                console.log(`[${roomId}] ✅ connectedUsers actualizado para ${realUsername} (socket: ${socketId})`);
                                break;
                            }
                        }
                    }
                }
            } else {
                // ▼▼▼ CRÍTICO: Enviar evento SOLO al jugador eliminado con redirect: true, y a los demás sin redirect ▼▼▼
                // Enviar a los demás jugadores (sin redirect) para que solo vean la notificación
                io.to(roomId).except(leavingPlayerId).emit('playerEliminated', {
                    playerId: leavingPlayerId,
                    playerName: playerName,
                    reason: reason,
                    faultData: { reason: abandonmentReason },
                    redirect: false, // NO redirigir a los demás jugadores
                    penaltyInfo: { amount: penaltyAmount, reason: 'Abandono' }
                });
                
                // Enviar SOLO al jugador eliminado con redirect: true para expulsarlo al lobby
            const leavingSocket = io.sockets.sockets.get(leavingPlayerId);
            if (leavingSocket) {
                leavingSocket.emit('playerEliminated', {
                    playerId: leavingPlayerId,
                    playerName: playerName,
                    reason: reason,
                    faultData: { reason: abandonmentReason },
                        redirect: true, // IMPORTANTE: Solo este jugador debe ser redirigido
                    penaltyInfo: { amount: penaltyAmount, reason: 'Abandono' }
                });
                    console.log(`[${roomId}] ✅ Evento playerEliminated enviado SOLO a ${playerName} (${leavingPlayerId}) con redirect: true. Los demás jugadores recibieron redirect: false`);
            }
            }
            // ▲▲▲ FIN ENVÍO CORREGIDO ▲▲▲

            if (leavingPlayerSeat && leavingPlayerSeat.userId) {
                const penalty = room.settings.penalty || 0;
                const playerInfo = users[leavingPlayerSeat.userId];
                if (penalty > 0 && playerInfo) {
                    const penaltyInPlayerCurrency = convertCurrency(penalty, room.settings.betCurrency, playerInfo.currency, exchangeRates);
                    playerInfo.credits -= penaltyInPlayerCurrency;

                    // ▼▼▼ LÍNEA AÑADIDA: Guardar en la Base de Datos ▼▼▼
                    await updateUserCredits(leavingPlayerSeat.userId, playerInfo.credits, playerInfo.currency);
                    // ▲▲▲ FIN DE LA LÍNEA AÑADIDA ▲▲▲

                    // Sumar la multa al bote (en la moneda de la mesa)
                    const currentPot = room.pot || 0;
                    room.pot = currentPot + penalty;
                    
                    // Rastrear la multa pagada
                    if (!room.penaltiesPaid) room.penaltiesPaid = {};
                    room.penaltiesPaid[leavingPlayerSeat.userId] = {
                        playerName: playerName,
                        amount: parseFloat(penalty), // IMPORTANTE: Forzar número aquí
                        reason: 'Abandono por inactividad'
                    };
                    
                    console.log(`[${roomId}] 💰 Multa aplicada: ${penalty} ${room.settings.betCurrency} a ${playerName}. Bote actualizado: ${currentPot} → ${room.pot}`);
                    
                    io.to(leavingPlayerId).emit('userStateUpdated', playerInfo);
                    io.to(room.roomId).emit('potUpdated', { newPotValue: room.pot, isPenalty: true });
                } else {
                    console.log(`[${roomId}] ⚠️ No se aplicó multa: penalty=${penalty}, playerInfo=${!!playerInfo}`);
                }
            } else {
                console.log(`[${roomId}] ⚠️ No se aplicó multa: leavingPlayerSeat=${!!leavingPlayerSeat}, userId=${leavingPlayerSeat?.userId}`);
            }

            // ▼▼▼ ACTUALIZAR ESTADO DEL USUARIO EN CONNECTEDUSERS ▼▼▼
            // CRÍTICO: Mantener el nombre correcto y actualizar el estado
            if (connectedUsers[leavingPlayerId]) {
                // Asegurar que el nombre se mantenga correcto (no se convierta en "Usuario")
                if (!connectedUsers[leavingPlayerId].username || connectedUsers[leavingPlayerId].username === 'Usuario') {
                    // Intentar recuperar el nombre real desde users o desde el asiento
                    if (leavingUserId && users[leavingUserId]) {
                        connectedUsers[leavingPlayerId].username = users[leavingUserId].username || playerName;
                    } else {
                        connectedUsers[leavingPlayerId].username = playerName;
                    }
                    console.log(`[${roomId}] ✅ Nombre corregido en connectedUsers para ${leavingPlayerId}: ${connectedUsers[leavingPlayerId].username}`);
                }
                
                const currentLobby = connectedUsers[leavingPlayerId].currentLobby || 'La 51';
                connectedUsers[leavingPlayerId].status = `En el lobby de ${currentLobby}`;
                connectedUsers[leavingPlayerId].currentLobby = 'La 51'; // Asegurar que esté en el lobby de La 51
                
                // Actualizar la lista de usuarios para que todos vean el nombre correcto
                broadcastUserListUpdate(io);
            } else if (leavingUserId) {
                // Si no existe en connectedUsers, crearlo con el nombre correcto
                const realUsername = users[leavingUserId]?.username || playerName;
                connectedUsers[leavingPlayerId] = {
                    username: realUsername,
                    status: 'En el lobby de La 51',
                    currentLobby: 'La 51'
                };
                broadcastUserListUpdate(io);
                console.log(`[${roomId}] ✅ Jugador ${realUsername} agregado a connectedUsers con nombre correcto`);
            }
            // ▲▲▲ FIN DE ACTUALIZACIÓN DE ESTADO ▲▲▲
            
            const activePlayers = room.seats.filter(s => s && s.active !== false);
            if (activePlayers.length === 1) {
                await endGameAndCalculateScores(room, activePlayers[0], io, { name: playerName });
                return;
            } else if (activePlayers.length > 1) {
                if (room.currentPlayerId === leavingPlayerId) {
                    resetTurnState(room);
                    let oldPlayerIndex = -1;
                    if (room.initialSeats) {
                        oldPlayerIndex = room.initialSeats.findIndex(s => s && s.playerId === leavingPlayerId);
                    }
                    let nextPlayerIndex = oldPlayerIndex !== -1 ? oldPlayerIndex : 0;
                    let attempts = 0;
                    let nextPlayer = null;
                    while (!nextPlayer && attempts < room.seats.length * 2) {
                        nextPlayerIndex = (nextPlayerIndex + 1) % room.seats.length;
                        const potentialNextPlayerSeat = room.seats[nextPlayerIndex];
                        if (potentialNextPlayerSeat && potentialNextPlayerSeat.active) {
                            nextPlayer = potentialNextPlayerSeat;
                        }
                        attempts++;
                    }
                    if (nextPlayer) {
                        room.currentPlayerId = nextPlayer.playerId;
                        
                        const nextPlayerSeat = room.seats.find(s => s && s.playerId === room.currentPlayerId);
                        if (nextPlayerSeat && nextPlayerSeat.isBot) {
                            setTimeout(() => botPlay(room, room.currentPlayerId, io), 1000);
                        } else {
                            // Iniciar timeout usando la lógica de Ludo (copiada exactamente)
                            const newTimeoutKey = `${roomId}_${nextPlayer.userId}`;
                            const alreadyPenalized = (room.penaltyApplied && room.penaltyApplied[nextPlayer.userId]);
                            if (!alreadyPenalized) {
                                if (la51InactivityTimeouts[newTimeoutKey]) {
                                    clearTimeout(la51InactivityTimeouts[newTimeoutKey]);
                                    delete la51InactivityTimeouts[newTimeoutKey];
                                }
                                const newTimeoutKeyByPlayerId = `${roomId}_${nextPlayer.playerId}`;
                                if (la51InactivityTimeouts[newTimeoutKeyByPlayerId]) {
                                    clearTimeout(la51InactivityTimeouts[newTimeoutKeyByPlayerId]);
                                    delete la51InactivityTimeouts[newTimeoutKeyByPlayerId];
                                }
                                Object.keys(la51InactivityTimeouts).forEach(key => {
                                    if (key.startsWith(`${roomId}_`) && (key.includes(nextPlayer.userId) || key.includes(nextPlayer.playerId))) {
                                        clearTimeout(la51InactivityTimeouts[key]);
                                        delete la51InactivityTimeouts[key];
                                    }
                                });
                                la51InactivityTimeouts[newTimeoutKey] = setTimeout(() => {
                                    const currentRoom = la51Rooms[roomId];
                                    if (!currentRoom || currentRoom.currentPlayerId !== nextPlayer.playerId) {
                                        const currentSeat = currentRoom.seats.find(s => s && s.userId === nextPlayer.userId);
                                        if (!currentSeat || currentRoom.currentPlayerId !== currentSeat.playerId) {
                                            delete la51InactivityTimeouts[newTimeoutKey];
                                            return;
                                        }
                                    }
                                    const currentSeat = currentRoom.seats.find(s => s && s.userId === nextPlayer.userId);
                                    if (!currentSeat || currentSeat.userId !== nextPlayer.userId) {
                                        delete la51InactivityTimeouts[newTimeoutKey];
                                        return;
                                    }
                                    if (!currentRoom.penaltyApplied) currentRoom.penaltyApplied = {};
                                    currentRoom.penaltyApplied[currentSeat.userId] = true;
                                    let playerIdToUse = currentSeat.playerId;
                                    if (!playerIdToUse && currentSeat.userId) {
                                        for (const [socketId, socket] of io.sockets.sockets.entries()) {
                                            const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                                            if (socketUserId === currentSeat.userId) {
                                                playerIdToUse = socketId;
                                                break;
                                            }
                                        }
                                    }
                                    if (playerIdToUse) {
                                        handlePlayerDeparture(roomId, playerIdToUse, io, true);
                                    }
                                    delete la51InactivityTimeouts[newTimeoutKey];
                                }, LA51_INACTIVITY_TIMEOUT_MS);
                            }
                        }
                        
                        io.to(roomId).emit('turnChanged', {
                            discardedCard: null,
                            discardingPlayerId: leavingPlayerId,
                            newDiscardPile: room.discardPile,
                            nextPlayerId: room.currentPlayerId,
                            playerHandCounts: getSanitizedRoomForClient(room).playerHandCounts,
                            newMelds: room.melds
                        });
                    }
                }
            }
            
            // ▼▼▼ CRÍTICO: Liberar el asiento DESPUÉS de pasar el turno y procesar todo ▼▼▼
            // Esto asegura que el turno se pase correctamente antes de liberar el asiento
            if (room.state === 'playing' && wasActive) {
                room.seats[seatIndex] = null;
                console.log(`[${roomId}] ✅ Asiento ${seatIndex} liberado después de procesar eliminación y pasar turno`);
            }
            // ▲▲▲ FIN LIBERACIÓN DE ASIENTO ▲▲▲
        } else {
            // --- JUGADOR EN ESPERA: No hay multa, solo se notifica ---
            console.log(`Jugador ${playerName} ha salido mientras esperaba. No se aplica multa.`);
            // Liberar asiento inmediatamente si está en espera
            room.seats[seatIndex] = null;
            io.to(roomId).emit('playerAbandoned', {
                message: `${playerName} ha abandonado la mesa antes de empezar la partida.`
            });
        }
    }
    
    handleHostLeaving(room, leavingPlayerId, io);
    io.to(roomId).emit('playerLeft', getSanitizedRoomForClient(room));
    checkAndCleanRoom(roomId, io);
}

function createAndStartPracticeGame(socket, username, avatar, io) {
    const roomId = `practice-${socket.id}`;
    const botAvatars = [ 'https://i.pravatar.cc/150?img=52', 'https://i.pravatar.cc/150?img=51', 'https://i.pravatar.cc/150?img=50' ];

    const newRoom = {
      roomId: roomId,
      hostId: socket.id,
      settings: { username: "Práctica", bet: 0, penalty: 0 },
      state: 'playing',
      isPractice: true,
      seats: [
        { playerId: socket.id, playerName: username, avatar: avatar, active: true, doneFirstMeld: false, isBot: false },
        { playerId: 'bot_1', playerName: 'Bot 1', avatar: botAvatars[0], active: true, doneFirstMeld: false, isBot: true },
        { playerId: 'bot_2', playerName: 'Bot 2', avatar: botAvatars[1], active: true, doneFirstMeld: false, isBot: true },
        { playerId: 'bot_3', playerName: 'Bot 3', avatar: botAvatars[2], active: true, doneFirstMeld: false, isBot: true }
      ],
      deck: [], discardPile: [], playerHands: {}, melds: [], turnMelds: [], turnPoints: 0, hasDrawn: false, drewFromDiscard: null, firstMeldCompletedByAnyone: false, rematchRequests: new Set()
    };

    const deck = buildDeck();
    shuffle(deck);
    newRoom.seats.forEach(seat => {
        if (seat) newRoom.playerHands[seat.playerId] = deck.splice(0, 14);
    });

    const startingPlayerId = newRoom.seats[0].playerId;
    newRoom.playerHands[startingPlayerId].push(deck.shift());
    newRoom.hasDrawn = true;

    newRoom.discardPile.push(deck.shift());
    newRoom.deck = deck;
    newRoom.currentPlayerId = startingPlayerId;

    la51Rooms[roomId] = newRoom;
    socket.join(roomId);
    socket.currentRoomId = roomId; // Aseguramos que la sala actual se actualice

    const playerHandCounts = {};
    newRoom.seats.forEach(p => { 
        if(p) playerHandCounts[p.playerId] = newRoom.playerHands[p.playerId].length; 
    });

    const humanPlayer = newRoom.seats.find(s => s && !s.isBot);
    const isStartingPlayer = humanPlayer && humanPlayer.playerId === startingPlayerId;

    io.to(socket.id).emit('gameStarted', {
        hand: newRoom.playerHands[socket.id],
        discardPile: newRoom.discardPile,
        seats: newRoom.seats,
        currentPlayerId: newRoom.currentPlayerId,
        playerHandCounts: playerHandCounts,
        melds: newRoom.melds,
        isPractice: true,
        isFirstTurn: isStartingPlayer // Indicar si es el primer turno
    });
    
    // ▼▼▼ MENSAJE PARA EL JUGADOR QUE INICIA EN MESA DE PRÁCTICA ▼▼▼
    // El jugador humano siempre es el que inicia en mesas de práctica
    // IMPORTANTE: Enviar con un delay mayor para asegurar que el listener y el DOM estén listos
    if (isStartingPlayer) {
        console.log(`[createAndStartPracticeGame] Enviando firstTurnInfo a ${humanPlayer.playerName} (${startingPlayerId})`);
        setTimeout(() => {
            io.to(startingPlayerId).emit('firstTurnInfo', {
                message: '¡Es tu primer turno! Empiezas con 15 cartas. Debes descartar una carta para comenzar el juego.',
                playerName: humanPlayer.playerName
            });
            console.log(`[createAndStartPracticeGame] ✅ firstTurnInfo enviado a ${humanPlayer.playerName}`);
        }, 1500); // Delay aumentado a 1500ms para asegurar que todo esté listo
    }
}

// --- FIN: SECCIÓN DE ADMINISTRACIÓN ---

// --- MANEJO DE RUTAS (REEMPLAZAR ESTE BLOQUE) ---

// NOTA: El middleware de archivos estáticos ya está configurado arriba (línea 3409)
// No es necesario duplicarlo aquí

// Ruta para el menú de selección
app.get('/select', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/select.html'));
});

// Ruta para el juego LA 51
app.get('/la51', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/la51/la51index.html'));
});

// Ruta para el LOBBY de Ludo
app.get('/ludo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/ludo/ludoindex.html'));
});

// Ruta para el JUEGO de Ludo
app.get('/ludo-game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/ludo/ludo.html'));
});

// 4. Ruta "catch-all" (debe ir AL FINAL de todas las rutas)
// Sirve el NUEVO login unificado
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// La ruta de admin sigue igual, pero apunta a /public
// (Nota: La ruta /admin ya está definida arriba con adminAuth)

// Las rutas de API (/login, /register) se mantienen como están
// --- FIN MANEJO DE RUTAS ---

// --- MANEJO DE SOCKETS ---
io.on('connection', (socket) => {
  console.log('✅ Un jugador se ha conectado:', socket.id);
  console.log('ESTADO ACTUAL DE LAS MESAS EN EL SERVIDOR:', la51Rooms);

  // No enviamos historial aquí, se enviará cuando el usuario entre al lobby específico

  // Envía la lista de salas de La 51
  socket.emit('updateRoomList', Object.values(la51Rooms));
  
  // Envía la lista de salas de LUDO solo a este socket
  const ludoRoomsArray = Object.values(ludoRooms);
  console.log(`[io.on connection] Enviando ${ludoRoomsArray.length} salas de Ludo al nuevo socket ${socket.id}`);
  socket.emit('updateLudoRoomList', ludoRoomsArray);
  // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

    // --- INICIO: LÓGICA PARA EL PANEL DE ADMIN ---

    // Escucha la petición del panel de admin para obtener la lista de usuarios
    socket.on('admin:requestUserList', async () => { // <-- Se añade 'async'
        socket.join('admin-room');
        console.log(`Socket ${socket.id} se ha unido a la sala de administradores.`);

        // Cargar comisiones de la base de datos si está habilitada
        if (!DISABLE_DB) {
            try {
                const result = await pool.query('SELECT id, amount, currency, timestamp FROM commission_log ORDER BY timestamp ASC');
                commissionLog = result.rows.map(row => ({
                    id: row.id,
                    amount: parseFloat(row.amount),
                    currency: row.currency,
                    timestamp: row.timestamp ? new Date(row.timestamp).getTime() : Date.now()
                }));
            } catch (error) {
                console.error('Error cargando comisiones de BD:', error);
            }
        }

        socket.emit('admin:commissionData', commissionLog);

        // AHORA LEE DIRECTAMENTE DE LA BASE DE DATOS
        const allUsers = await getAllUsersFromDB();
        
        if (allUsers.length > 0) {
            io.to('admin-room').emit('admin:userList', allUsers);
        } else {
            io.to('admin-room').emit('admin:userList', []);
        }
    });

    // ▼▼▼ LISTENER PARA OBTENER LISTA COMPLETA DE USUARIOS CON TODOS LOS CAMPOS ▼▼▼
    socket.on('admin:requestFullUserList', async () => {
        const fullUsers = await getFullUsersFromDB();
        socket.emit('admin:fullUserList', fullUsers);
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // Escucha la orden del admin para actualizar los créditos de un usuario
    socket.on('admin:updateCredits', async ({ userId, newCredits, newCurrency }) => {
        const credits = parseFloat(newCredits);
        const userExistsInMemory = users[userId]; // Comprobamos si el usuario está activo

        if (!isNaN(credits) && ['EUR', 'USD', 'COP'].includes(newCurrency)) {
            console.log(`[Admin] Actualizando datos para ${userId}.`);
            
            // Actualizamos la base de datos primero
            await updateUserCredits(userId, credits, newCurrency);

            // Si el usuario está conectado, actualizamos su estado en memoria y le notificamos
            if (userExistsInMemory) {
                users[userId].credits = credits;
                users[userId].currency = newCurrency;

                for (const [id, socketInstance] of io.of("/").sockets) {
                    if (socketInstance.userId === userId) {
                        socketInstance.emit('userStateUpdated', users[userId]);
                        break; 
                    }
                }
            }

            // Reenviamos la lista completa y actualizada desde la base de datos al admin
            const allUsers = await getAllUsersFromDB();
            io.to('admin-room').emit('admin:userList', allUsers);
        }
    });

    // ▼▼▼ LISTENER PARA ACTUALIZAR CONTRASEÑA ▼▼▼
    // Escucha la orden del admin para actualizar la contraseña
    socket.on('admin:updatePassword', async ({ username, newPassword }) => {
        if (username && newPassword && newPassword.length >= 4) {
             console.log(`[Admin] Petición para actualizar contraseña de ${username}`);
             await updateUserPassword(username, newPassword);
             // Opcional: puedes enviar una confirmación de vuelta
             socket.emit('admin:passwordUpdated', { success: true, username });
        } else {
             console.log(`[Admin] Petición de cambio de contraseña inválida para ${username}`);
             socket.emit('admin:passwordUpdated', { success: false, username, message: 'La contraseña debe tener al menos 4 caracteres.' });
        }
    });
    // ▲▲▲ FIN DEL LISTENER ▲▲▲

    // ▼▼▼ INICIO DEL NUEVO LISTENER PARA CAMBIO DE CONTRASEÑA DE USUARIO ▼▼▼
    socket.on('user:changePassword', async ({ username, currentPassword, newPassword }) => {
        try {
            if (!username || !currentPassword || !newPassword) {
                return socket.emit('user:changePasswordResponse', { success: false, message: 'Datos incompletos.' });
            }

            // 1. Obtener el hash actual del usuario desde la BD
            const result = await pool.query('SELECT password_hash FROM users WHERE username = $1', [username.toLowerCase()]);
            if (result.rows.length === 0) {
                return socket.emit('user:changePasswordResponse', { success: false, message: 'Error: Usuario no encontrado.' });
            }
            const currentHash = result.rows[0].password_hash;

            // 2. Comparar la contraseña actual proporcionada con el hash
            const isMatch = await bcrypt.compare(currentPassword, currentHash);
            if (!isMatch) {
                return socket.emit('user:changePasswordResponse', { success: false, message: 'La contraseña actual es incorrecta.' });
            }

            // 3. Si coincide, hashear y actualizar la nueva contraseña
            const saltRounds = 10;
            const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
            await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [newPasswordHash, username.toLowerCase()]);

            console.log(`✅ Contraseña cambiada exitosamente por el usuario ${username}.`);
            socket.emit('user:changePasswordResponse', { success: true, message: '¡Contraseña actualizada con éxito!' });

        } catch (error) {
            console.error(`❌ Error al cambiar la contraseña para ${username}:`, error);
            socket.emit('user:changePasswordResponse', { success: false, message: 'Error interno del servidor. Inténtalo más tarde.' });
        }
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // Escucha la orden del admin para eliminar un usuario
    socket.on('admin:deleteUser', async ({ userId }) => {
        const username = userId.replace(/^user_/, ''); // Extraemos el username del id
        console.log(`[Admin] Petición para eliminar al usuario: ${username} (ID: ${userId})`);

        // 1. Eliminar de la base de datos
        const deletedFromDB = await deleteUserFromDB(username);

        if (deletedFromDB) {
            // 2. Eliminar del objeto en memoria (si existe)
            if (users[userId]) {
                delete users[userId];
            }

            // 3. Obtener la lista actualizada y notificar a todos los admins
            const allUsers = await getAllUsersFromDB();
            io.to('admin-room').emit('admin:userList', allUsers);
            console.log(`[Admin] Lista de usuarios actualizada enviada tras eliminación.`);
        } else {
            console.log(`[Admin] No se pudo eliminar al usuario ${username}, puede que ya no exista.`);
            // Opcional: notificar al admin de un posible error
            const allUsers = await getAllUsersFromDB();
            io.to('admin-room').emit('admin:userList', allUsers);
        }
    });

    // ▼▼▼ AÑADE ESTE LISTENER ▼▼▼
    socket.on('requestInitialData', () => {
        socket.emit('exchangeRatesUpdate', exchangeRates);
        // ▼▼▼ CORRECCIÓN: Enviar lista de salas de Ludo y usuarios al conectar ▼▼▼
        const ludoRoomsArray = Object.values(ludoRooms);
        const usersArray = Object.values(connectedUsers);
        console.log(`[requestInitialData] Enviando ${ludoRoomsArray.length} salas de Ludo y ${usersArray.length} usuarios al socket ${socket.id}`);
        socket.emit('updateLudoRoomList', ludoRoomsArray);
        socket.emit('updateUserList', usersArray);
        // Enviar historial del chat del lobby de Ludo
        socket.emit('ludoLobbyChatHistory', ludoLobbyChatHistory);
        // Enviar historial del chat del lobby de La 51
        socket.emit('la51LobbyChatHistory', la51LobbyChatHistory);
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
    });
    // ▲▲▲ FIN DEL LISTENER ▲▲▲

    // Eventos para rastrear en qué lobby está el usuario
    socket.on('enterLudoLobby', () => {
        // 1. Intentar recuperar el nombre real de todas las fuentes posibles
        let finalUsername = connectedUsers[socket.id]?.username;
        
        if (!finalUsername || finalUsername === 'Usuario') {
            if (socket.userId && users[socket.userId]) {
                finalUsername = users[socket.userId].username;
            } else if (socket.userId) {
                finalUsername = socket.userId.replace(/^user_/, '');
            }
        }
        
        // Si aún así no hay nombre, esperar a userLoggedIn, pero no crear "Usuario" fantasma si es posible
        finalUsername = finalUsername || 'Usuario';

        // 2. Actualizar estado CLARAMENTE
            connectedUsers[socket.id] = {
            username: finalUsername,
                status: 'En el lobby de Ludo',
                currentLobby: 'Ludo'
            };
        
        // 3. Limpiar duplicados viejos de este mismo usuario
        if (finalUsername !== 'Usuario') {
            Object.keys(connectedUsers).forEach(otherSocketId => {
                if (otherSocketId !== socket.id && connectedUsers[otherSocketId].username === finalUsername) {
                    delete connectedUsers[otherSocketId];
                }
            });
        }

            broadcastUserListUpdate(io);
    });

    socket.on('enterLa51Lobby', () => {
        // 1. Intentar recuperar el nombre real (Igual que arriba)
        let finalUsername = connectedUsers[socket.id]?.username;
        
        if (!finalUsername || finalUsername === 'Usuario') {
            if (socket.userId && users[socket.userId]) {
                finalUsername = users[socket.userId].username;
            } else if (socket.userId) {
                finalUsername = socket.userId.replace(/^user_/, '');
            }
        }
        
        finalUsername = finalUsername || 'Usuario';

        // 2. Actualizar estado CLARAMENTE
            connectedUsers[socket.id] = {
            username: finalUsername,
                status: 'En el lobby de La 51',
                currentLobby: 'La 51'
            };

        // 3. Limpiar duplicados viejos
        if (finalUsername !== 'Usuario') {
            Object.keys(connectedUsers).forEach(otherSocketId => {
                if (otherSocketId !== socket.id && connectedUsers[otherSocketId].username === finalUsername) {
                    delete connectedUsers[otherSocketId];
                }
            });
        }
        
        broadcastUserListUpdate(io);
    });

    // Escucha cuando un usuario inicia sesión en el lobby
    socket.on('userLoggedIn', async ({ username, currency }) => {
        if (!username || !currency) return;

        const userId = 'user_' + username.toLowerCase();
        socket.userId = userId;

        // ▼▼▼ CORRECCIÓN: Respetar estado previo si ya entró a un lobby específico ▼▼▼
        let currentStatus = 'En el Lobby';
        let currentLobby = null;

        // Si el socket ya tenía un estado específico (ej: En el lobby de Ludo), lo mantenemos
        if (connectedUsers[socket.id]) {
            if (connectedUsers[socket.id].currentLobby) {
                currentLobby = connectedUsers[socket.id].currentLobby;
                currentStatus = `En el lobby de ${currentLobby}`;
            }
        }

        connectedUsers[socket.id] = {
            username: username,
            status: currentStatus, // Usamos el estado inteligente
            currentLobby: currentLobby
        };
        // ▲▲▲ FIN CORRECCIÓN ▲▲▲

        broadcastUserListUpdate(io);
        
        // Enviar lista de salas de Ludo al usuario
        const ludoRoomsArray = Object.values(ludoRooms);
        socket.emit('updateLudoRoomList', ludoRoomsArray);

        try {
            const userData = await getUserByUsername(username);
            if (!userData) {
                console.error(`Error crítico: el usuario '${username}' no se encontró en la BD.`);
                return;
            }
            
            if (userData.currency !== currency) {
                await updateUserCredits(userId, userData.credits, currency);
                userData.currency = currency;
            }
            
            users[userId] = userData;
            socket.emit('userStateUpdated', users[userId]);
        } catch (error) {
            console.error('Error cargando usuario desde BD:', error);
            users[userId] = { credits: 0, currency: currency };
            socket.emit('userStateUpdated', users[userId]);
        }

        const allUsers = await getAllUsersFromDB();
        io.to('admin-room').emit('admin:userList', allUsers);
    });

    socket.on('admin:resetCommissions', async () => {
        console.log(`[Admin] Se han reiniciado las ganancias acumuladas.`);
        commissionLog = []; // Vaciamos el array del historial
        
        // También limpiar la base de datos si está habilitada
        if (!DISABLE_DB) {
            try {
                await pool.query('DELETE FROM commission_log');
                console.log(`[Admin] Comisiones eliminadas de la base de datos.`);
            } catch (error) {
                console.error('Error eliminando comisiones de la BD:', error);
            }
        }
        
        // Notificamos a todos los paneles de admin que los datos han sido reseteados
        io.to('admin-room').emit('admin:commissionData', commissionLog);
    });

    // ▼▼▼ AÑADE ESTOS DOS LISTENERS ▼▼▼
    socket.on('admin:requestRates', () => {
        socket.emit('admin:exchangeRates', exchangeRates);
    });

    socket.on('admin:updateRates', async (newRates) => {
        console.log('[Admin] Actualizando tasas de cambio:', newRates);
        // Actualizamos nuestro objeto en memoria
        exchangeRates.EUR.COP = newRates.EUR_COP || 4500;
        exchangeRates.USD.COP = newRates.USD_COP || 4500;
        exchangeRates.EUR.USD = newRates.EUR_USD || 1.05;

        // Recalculamos las inversas
        exchangeRates.COP.EUR = 1 / exchangeRates.EUR.COP;
        exchangeRates.COP.USD = 1 / exchangeRates.USD.COP;
        exchangeRates.USD.EUR = 1 / exchangeRates.EUR.USD;

        // Guardar en la base de datos
        if (!DISABLE_DB) {
            try {
                await pool.query(`
                    INSERT INTO exchange_rates (eur_cop, usd_cop, eur_usd) 
                    VALUES ($1, $2, $3)
                `, [exchangeRates.EUR.COP, exchangeRates.USD.COP, exchangeRates.EUR.USD]);
                console.log('✅ Tasas de cambio guardadas en la base de datos');
            } catch (error) {
                console.error('Error guardando tasas de cambio en BD:', error);
            }
        }

        // Notificamos a TODOS los clientes (jugadores y admins) de las nuevas tasas
        io.emit('exchangeRatesUpdate', exchangeRates);
    });
    // ▲▲▲ FIN DE LOS LISTENERS ▲▲▲

    // --- FIN: LÓGICA PARA EL PANEL DE ADMIN ---

  socket.on('createRoom', async (settings) => {
    console.log(`[createRoom] Iniciando creación de mesa para socket ${socket.id}. Estado actual:`, {
        currentRoomId: socket.currentRoomId,
        userId: socket.userId,
        rooms: Array.from(socket.rooms || [])
    });
    
    // ▼▼▼ LIMPIEZA DE ESTADO DEPREDADOR MEJORADA ▼▼▼
    // 1. Forzar salida de TODAS las salas anteriores
    if (socket.rooms) {
        for (const room of Array.from(socket.rooms)) {
            if (room !== socket.id) {
                socket.leave(room); // Desconectar físicamente
                console.log(`[createRoom] 🧹 Limpieza forzada: Socket ${socket.id} desconectado de sala residual ${room}`);
            }
        }
    }
    
    // 2. Limpiar referencia interna
    delete socket.currentRoomId;
    console.log(`[createRoom] ✅ socket.currentRoomId eliminado`);
    
    // 3. BARRIDO DE PRÁCTICAS HUÉRFANAS (Añadir esta lógica específica)
    // Buscamos si existe alguna sala de práctica donde este usuario sea el dueño y la borramos.
    const practiceRoomId = `practice-${socket.id}`;
    if (la51Rooms[practiceRoomId]) {
        console.log(`[createRoom] 🧹 Se encontró una mesa de práctica residual (${practiceRoomId}). Eliminándola.`);
        delete la51Rooms[practiceRoomId];
    }
    
    // 4. Limpiar cualquier sala de práctica huérfana en memoria (búsqueda adicional)
    const allRoomIds = Object.keys(la51Rooms);
    for (const rId of allRoomIds) {
        const r = la51Rooms[rId];
        if (r && r.isPractice && (r.hostId === socket.id || r.seats.some(s => s && s.playerId === socket.id))) {
            console.log(`[createRoom] 🧹 Eliminando mesa de práctica huérfana ${rId} detectada antes de crear nueva mesa.`);
            delete la51Rooms[rId];
        }
    }
    
    // 5. Verificar que el estado esté completamente limpio antes de continuar
    if (socket.currentRoomId) {
        console.warn(`[createRoom] ⚠️ ADVERTENCIA: socket.currentRoomId aún existe después de limpieza: ${socket.currentRoomId}. Forzando eliminación.`);
        delete socket.currentRoomId;
    }
    
    console.log(`[createRoom] ✅ Estado limpio. Continuando con creación de mesa...`);
    // ▲▲▲ FIN DE LIMPIEZA PREVIA ▲▲▲
    
    const roomId = generateRoomId();

    const userId = 'user_' + settings.username.toLowerCase();
    console.log(`[Servidor] Asignando userId al creador '${settings.username}': ${userId}`);

    socket.userId = userId;

    // Intentar obtener playerInfo de múltiples fuentes
    let playerInfo = users[userId];
    
    console.log(`[createRoom] Buscando playerInfo para userId: ${userId}, username: ${settings.username}`);
    console.log(`[createRoom] socket.userId: ${socket.userId}, socket.currentRoomId: ${socket.currentRoomId}`);
    
    // Si no se encuentra con userId, intentar con username directamente
    if (!playerInfo && settings.username) {
        const usernameKey = settings.username.toLowerCase();
        playerInfo = users[usernameKey];
        if (playerInfo) {
            // Si se encontró con username, actualizar la referencia con userId
            users[userId] = playerInfo;
            console.log(`[createRoom] Usuario encontrado con usernameKey: ${usernameKey}`);
        }
    }
    
    // Si aún no se encuentra, intentar obtener desde connectedUsers
    if (!playerInfo && connectedUsers[socket.id]) {
        const connectedUser = connectedUsers[socket.id];
        const connectedUsername = connectedUser.username?.toLowerCase();
        if (connectedUsername) {
            const connectedUserId = 'user_' + connectedUsername;
            playerInfo = users[connectedUserId] || users[connectedUsername];
            if (playerInfo) {
                console.log(`[createRoom] Usuario encontrado desde connectedUsers: ${connectedUserId}`);
            }
        }
    }
    
    // Si aún no se encuentra, intentar recargar desde la base de datos
    if (!playerInfo && settings.username) {
        try {
            console.log(`[createRoom] Usuario no encontrado en memoria, intentando recargar desde BD: ${settings.username}`);
            const userData = await getUserByUsername(settings.username);
            if (userData) {
                // Guardar en users con userId para futuras búsquedas
                users[userId] = userData;
                // También guardar con username por si acaso
                if (settings.username) {
                    users[settings.username.toLowerCase()] = userData;
                }
                playerInfo = userData;
                console.log(`[createRoom] ✅ Usuario recargado desde BD: ${userId}, créditos: ${userData.credits}, moneda: ${userData.currency}`);
            } else {
                console.error(`[createRoom] ❌ Usuario no encontrado en BD: ${settings.username}`);
            }
        } catch (error) {
            console.error(`[createRoom] Error al recargar usuario desde BD:`, error);
        }
    }
    
    // Validar que playerInfo existe
    if (!playerInfo) {
        console.error(`[createRoom] ERROR: playerInfo no encontrado para userId: ${userId}, username: ${settings.username}`);
        console.error(`[createRoom] Usuarios disponibles: ${Object.keys(users).join(', ')}`);
        console.error(`[createRoom] connectedUsers[socket.id]:`, connectedUsers[socket.id]);
        console.error(`[createRoom] socket.userId:`, socket.userId);
        return socket.emit('joinError', 'Error: Usuario no encontrado. Por favor, recarga la página.');
    }
    
    // Asegurar que playerInfo tenga todas las propiedades necesarias
    if (!playerInfo.credits && playerInfo.credits !== 0) {
        playerInfo.credits = 0;
        console.warn(`[createRoom] playerInfo.credits no definido, estableciendo a 0 para ${userId}`);
    }
    if (!playerInfo.currency) {
        playerInfo.currency = settings.betCurrency || 'USD';
        console.warn(`[createRoom] playerInfo.currency no definido, estableciendo a ${playerInfo.currency} para ${userId}`);
    }
    
    const roomBet = settings.bet || 0;
    const roomPenalty = settings.penalty || 0;
    const roomCurrency = settings.betCurrency || 'USD';

    // Calculamos el coste TOTAL (apuesta + multa) en la moneda de la mesa.
    const totalRequirementInRoomCurrency = roomBet + roomPenalty;

    // Convertimos el coste TOTAL a la moneda del jugador.
    const requiredAmountInPlayerCurrency = convertCurrency(totalRequirementInRoomCurrency, roomCurrency, playerInfo.currency, exchangeRates);

    if (playerInfo.credits < requiredAmountInPlayerCurrency) {
        const friendlyRequired = requiredAmountInPlayerCurrency.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const friendlyBet = roomBet.toLocaleString('es-ES');
        const friendlyPenalty = roomPenalty.toLocaleString('es-ES');

        return socket.emit('joinError', `Créditos insuficientes. Crear esta mesa de ${friendlyBet} ${roomCurrency} (+${friendlyPenalty} de multa) requiere aprox. ${friendlyRequired} ${playerInfo.currency}.`);
    }

    const newRoom = {
      roomId: roomId,
      hostId: socket.id,
      settings: settings,
      players: [{ id: socket.id, name: settings.username }],
      seats: [
        { 
          playerId: socket.id, 
          playerName: settings.username, 
          avatar: settings.userAvatar, 
          active: true, 
          doneFirstMeld: false,
          userId: userId 
        },
        null, null, null
      ],
      state: 'waiting',
      deck: [],
      discardPile: [],
      // ▼▼▼ CORRECCIÓN: Inicializar la mano del host como array vacío ▼▼▼
      // Esto evita errores en 'getSanitizedRoomForClient' si intenta leer la longitud
      playerHands: { [socket.id]: [] }, 
      // ▲▲▲ FIN CORRECCIÓN ▲▲▲
      melds: [],
      turnMelds: [],
      turnPoints: 0,
      hasDrawn: false,
      drewFromDiscard: null,
      firstMeldCompletedByAnyone: false,
      rematchRequests: new Set(),
      chatHistory: [{ sender: 'Sistema', message: `Mesa de ${settings.username} creada. ¡Buena suerte!` }],
      pot: 0 // Asegurar que pot esté inicializado
    };
    
    la51Rooms[roomId] = newRoom;
    socket.join(roomId);
    
    if (connectedUsers[socket.id]) {
        connectedUsers[socket.id].status = 'Jugando';
        broadcastUserListUpdate(io);
    }
    
    socket.currentRoomId = roomId;
    
    // Emitir eventos
    const sanitizedRoom = getSanitizedRoomForClient(newRoom);
    
    console.log(`[createRoom] ✅ Mesa creada: ${roomId}. Redirigiendo a ${settings.username}`);
    
    // ▼▼▼ FIX CRÍTICO: EMITIR TODOS LOS EVENTOS DE UNIÓN ▼▼▼
    // Algunos clientes esperan 'roomCreatedSuccessfully', otros 'joinedRoomSuccessfully'.
    // Emitimos ambos para asegurar la redirección.
    socket.emit('roomCreatedSuccessfully', sanitizedRoom);
    socket.emit('joinedRoomSuccessfully', sanitizedRoom); // <--- ESTO ES VITAL
    socket.emit('chatHistory', newRoom.chatHistory);
    // ▲▲▲ FIN FIX CRÍTICO ▲▲▲
    
    broadcastRoomListUpdate(io);
  });

  socket.on('requestPracticeGame', ({ username, avatar }) => { // <--- Recibimos un objeto
    // Llamamos a la función con los nuevos datos
    createAndStartPracticeGame(socket, username, avatar, io);
  });

    socket.on('joinRoom', async ({ roomId, user }) => {
        const room = la51Rooms[roomId];
        if (!room) {
            return socket.emit('joinError', 'La mesa no existe.');
        }

        // SOLUCIÓN DEFINITIVA: El servidor maneja completamente los IDs
        const userId = 'user_' + user.username.toLowerCase();
        console.log(`[Servidor] Gestionando entrada de '${user.username}' con ID: ${userId}`);
        
        socket.userId = userId; // Guardamos el userId en el socket para futuro uso

        // El usuario ya debe existir en users desde userLoggedIn
        
        // ▼▼▼ VERIFICAR SI EL JUGADOR FUE ELIMINADO POR INACTIVIDAD ▼▼▼
        const eliminatedKey = `${roomId}_${userId}`;
        if (la51EliminatedPlayers[eliminatedKey]) {
            const eliminationInfo = la51EliminatedPlayers[eliminatedKey];
            console.log(`[${roomId}] ⚠️ Jugador ${user.username} (${userId}) intenta unirse pero fue eliminado por inactividad. Mostrando modal de falta.`);
            
            // ▼▼▼ LIMPIEZA ADICIONAL PARA ASEGURAR QUE PUEDA VOLVER A ENTRAR COMO NUEVO ▼▼▼
            // Asegurarse de que el socket no tenga referencias a esta sala
            if (socket.currentRoomId === roomId) {
                delete socket.currentRoomId;
                console.log(`[${roomId}] ✅ socket.currentRoomId eliminado para ${socket.id} antes de mostrar modal`);
            }
            // Asegurarse de que el socket salga de la sala
            socket.leave(roomId);
            
            // Limpiar cualquier asiento que pueda tener este userId en la sala
            if (room.seats) {
                for (let i = 0; i < room.seats.length; i++) {
                    if (room.seats[i] && room.seats[i].userId === userId) {
                        console.log(`[${roomId}] ✅ Limpiando asiento [${i}] del usuario ${userId}`);
                        room.seats[i] = null;
                    }
                }
            }
            
            // Limpiar initialSeats también
            if (room.initialSeats) {
                for (let i = 0; i < room.initialSeats.length; i++) {
                    if (room.initialSeats[i] && room.initialSeats[i].userId === userId) {
                        console.log(`[${roomId}] ✅ Limpiando initialSeats[${i}] del usuario ${userId}`);
                        room.initialSeats[i] = null;
                    }
                }
            }
            
            // Limpiar playerHands
            if (room.playerHands && room.playerHands[socket.id]) {
                delete room.playerHands[socket.id];
                console.log(`[${roomId}] ✅ Limpiando playerHands del socket ${socket.id}`);
            }
            
            // Limpiar rematchRequests
            if (room.rematchRequests && room.rematchRequests.has(socket.id)) {
                room.rematchRequests.delete(socket.id);
                console.log(`[${roomId}] ✅ Limpiando rematchRequests del socket ${socket.id}`);
            }
            // ▲▲▲ FIN DE LIMPIEZA ADICIONAL ▲▲▲
            
            // ▼▼▼ CRÍTICO: Actualizar connectedUsers con el nombre correcto ANTES de enviar el evento ▼▼▼
            // Esto previene que aparezca como "Usuario" en el lobby
            // CRÍTICO: Obtener el nombre real desde users[userId] si está disponible
            let realUsername = eliminationInfo.playerName || user.username;
            if (userId && users[userId] && users[userId].username) {
                realUsername = users[userId].username;
                console.log(`[${roomId}] ✅ Nombre real obtenido desde users[${userId}]: ${realUsername}`);
            }
            
            if (connectedUsers[socket.id]) {
                // Asegurar que el nombre se mantenga correcto (forzar actualización)
                connectedUsers[socket.id].username = realUsername;
                connectedUsers[socket.id].status = 'En el lobby de La 51';
                connectedUsers[socket.id].currentLobby = 'La 51';
                console.log(`[${roomId}] ✅ Nombre actualizado en connectedUsers para ${socket.id}: ${realUsername}`);
            } else {
                // Crear entrada si no existe
                connectedUsers[socket.id] = {
                    username: realUsername,
                    status: 'En el lobby de La 51',
                    currentLobby: 'La 51'
                };
                console.log(`[${roomId}] ✅ Jugador agregado a connectedUsers con nombre correcto: ${realUsername}`);
            }
            
            // CRÍTICO: También actualizar por userId para evitar duplicados
            if (userId) {
                // Buscar cualquier otra entrada con el mismo userId y actualizarla
                Object.keys(connectedUsers).forEach(socketId => {
                    const socketObj = io.sockets.sockets.get(socketId);
                    if (socketObj && socketObj.userId === userId && socketId !== socket.id) {
                        connectedUsers[socketId].username = realUsername;
                        connectedUsers[socketId].status = 'En el lobby de La 51';
                        connectedUsers[socketId].currentLobby = 'La 51';
                        console.log(`[${roomId}] ✅ Nombre actualizado en connectedUsers para socket duplicado ${socketId}: ${realUsername}`);
                    }
                });
            }
            
            broadcastUserListUpdate(io);
            // ▲▲▲ FIN DE ACTUALIZACIÓN DE CONNECTEDUSERS ▲▲▲
            
            // ▼▼▼ CRÍTICO: Enviar evento playerEliminated con toda la información para que vea el modal ▼▼▼
            // IMPORTANTE: Usar socket.id como playerId para que el cliente pueda identificar que es él
            const eliminationEvent = {
                playerId: socket.id, // CRÍTICO: Usar el socket.id actual para que el cliente lo identifique
                playerName: eliminationInfo.playerName || user.username,
                reason: eliminationInfo.reason || 'Abandono por inactividad',
                faultData: eliminationInfo.faultData || { reason: 'Abandono por inactividad' },
                redirect: true, // CRÍTICO: Redirigir al lobby después de mostrar el modal
                penaltyInfo: eliminationInfo.penaltyInfo
            };
            
            console.log(`[${roomId}] 🚨 Enviando playerEliminated a jugador que regresó:`, eliminationEvent);
            socket.emit('playerEliminated', eliminationEvent);
            console.log(`[${roomId}] ✅ Evento playerEliminated enviado a ${socket.id} con redirect: true`);
            // ▲▲▲ FIN DE ENVÍO DE EVENTO ▲▲▲
            
            // Limpiar la entrada DESPUÉS de enviar el evento (para que el modal se muestre)
            // Usar setTimeout para asegurar que el evento se envíe primero
            setTimeout(() => {
                delete la51EliminatedPlayers[eliminatedKey];
                console.log(`[${roomId}] ✅ Entrada de la51EliminatedPlayers eliminada para ${userId}. Puede volver a unirse como nuevo jugador.`);
            }, 100);
            
            // NO redirigir automáticamente - la redirección se manejará cuando el usuario cierre el modal
            // El cliente manejará la redirección cuando el usuario haga clic en "Aceptar" en el modal
            
            return; // No permitir que se una a la sala
        }
        // ▲▲▲ FIN VERIFICACIÓN DE ELIMINACIÓN POR INACTIVIDAD ▲▲▲

        // ▼▼▼ CRÍTICO: VERIFICAR SI EL JUGADOR YA ESTABA EN LA MESA (RECONEXIÓN) ▼▼▼
        // Si el jugador ya estaba en la mesa, permitirle reconectarse a su asiento
        let existingSeatIndex = -1;
        let existingSeat = null;
        
        // Buscar si el jugador ya tiene un asiento en la mesa
        for (let i = 0; i < room.seats.length; i++) {
            if (room.seats[i] && room.seats[i].userId === userId) {
                existingSeatIndex = i;
                existingSeat = room.seats[i];
                console.log(`[${roomId}] ✅ Jugador ${user.username} ya tiene asiento [${i}] en la mesa. Permitir reconexión.`);
                break;
            }
        }
        
        // Si el jugador ya estaba en la mesa, actualizar su socket.id y permitir reconexión
        if (existingSeat && existingSeatIndex !== -1) {
            console.log(`[${roomId}] 🔄 Jugador ${user.username} reconectándose a su asiento [${existingSeatIndex}]. Actualizando socket.id de ${existingSeat.playerId} a ${socket.id}`);
            
            // Actualizar el playerId con el nuevo socket.id
            existingSeat.playerId = socket.id;
            
            // Asegurar que el socket esté en la sala
            socket.join(roomId);
            socket.currentRoomId = roomId;
            
            // Cancelar cualquier timeout de inactividad que pueda estar activo (igual que en Ludo)
            const timeoutKeyByPlayerId = `${roomId}_${existingSeat.playerId}`;
            if (la51InactivityTimeouts[timeoutKeyByPlayerId]) {
                clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerId]);
                delete la51InactivityTimeouts[timeoutKeyByPlayerId];
            }
            if (userId) {
                const timeoutKeyByUserId = `${roomId}_${userId}`;
                if (la51InactivityTimeouts[timeoutKeyByUserId]) {
                    clearTimeout(la51InactivityTimeouts[timeoutKeyByUserId]);
                    delete la51InactivityTimeouts[timeoutKeyByUserId];
                }
            }
            Object.keys(la51InactivityTimeouts).forEach(key => {
                if (key.startsWith(`${roomId}_`) && (key.includes(existingSeat.playerId) || (userId && key.includes(userId)))) {
                    clearTimeout(la51InactivityTimeouts[key]);
                    delete la51InactivityTimeouts[key];
                }
            });
            
            // Limpiar de la lista de desconectados si existe (ya no se usa, pero por si acaso)
            const disconnectKey = `${roomId}_${userId}`;
            if (la51DisconnectedPlayers && la51DisconnectedPlayers[disconnectKey]) {
                delete la51DisconnectedPlayers[disconnectKey];
                console.log(`[${roomId}] ✅ Limpiando la51DisconnectedPlayers para ${userId}`);
            }
            
            // ▼▼▼ CRÍTICO: Cancelar timeout de inactividad cuando el jugador se reconecta ▼▼▼
            // Si el jugador se reconecta, puede continuar jugando normalmente
            const timeoutKeyByPlayerIdReconnect = `${roomId}_${socket.id}`;
            const timeoutKeyByUserIdReconnect = `${roomId}_${userId}`;
            if (la51InactivityTimeouts[timeoutKeyByPlayerIdReconnect]) {
                clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerIdReconnect]);
                delete la51InactivityTimeouts[timeoutKeyByPlayerIdReconnect];
                console.log(`[${roomId}] ✅ Timeout de inactividad cancelado para ${userId} (jugador se reconectó)`);
            }
            if (la51InactivityTimeouts[timeoutKeyByUserIdReconnect]) {
                clearTimeout(la51InactivityTimeouts[timeoutKeyByUserIdReconnect]);
                delete la51InactivityTimeouts[timeoutKeyByUserIdReconnect];
                console.log(`[${roomId}] ✅ Timeout de inactividad cancelado para ${userId} (jugador se reconectó)`);
            }
            // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
            Object.keys(la51InactivityTimeouts).forEach(key => {
                if (key.startsWith(`${roomId}_`) && (key.includes(userId) || key.includes(socket.id))) {
                    clearTimeout(la51InactivityTimeouts[key]);
                    delete la51InactivityTimeouts[key];
                    console.log(`[${roomId}] ✅ Timeout adicional cancelado para ${userId} (jugador se reconectó): ${key}`);
                }
            });
            // ▲▲▲ FIN CANCELACIÓN DE TIMEOUT AL RECONECTARSE ▲▲▲
            
            // Enviar el estado actual de la sala al jugador reconectado
            const sanitizedRoom = getSanitizedRoomForClient(room);
            socket.emit('joinedRoomSuccessfully', sanitizedRoom);
            
            // Si el juego está en curso, enviar el estado del juego
            if (room.state === 'playing') {
                if (room.playerHands && room.playerHands[existingSeat.playerId]) {
                    // Actualizar la clave en playerHands al nuevo socket.id
                    room.playerHands[socket.id] = room.playerHands[existingSeat.playerId];
                    delete room.playerHands[existingSeat.playerId];
                }
                
                // Enviar estado del juego actual
                const playerHandCounts = {};
                room.seats.forEach(s => { 
                    if(s) playerHandCounts[s.playerId] = room.playerHands[s.playerId]?.length || 0; 
                });
                
                socket.emit('gameStarted', {
                    hand: room.playerHands[socket.id] || [],
                    discardPile: room.discardPile || [],
                    seats: room.seats,
                    currentPlayerId: room.currentPlayerId,
                    playerHandCounts: playerHandCounts,
                    melds: room.melds || [],
                    isPractice: room.isPractice || false
                });
            }
            
            console.log(`[${roomId}] ✅ Jugador ${user.username} reconectado exitosamente a su asiento [${existingSeatIndex}]`);
            return; // Salir temprano, no procesar más
        }
        // ▲▲▲ FIN DE VERIFICACIÓN DE RECONEXIÓN ▲▲▲

        // --- LÓGICA ANTI-ROBO DE IDENTIDAD: LIMPIEZA AGRESIVA (SOLO SI NO ES RECONEXIÓN) ---
        // 1. Limpiamos CUALQUIER asiento que tenga el mismo userId (solo si no es reconexión)
        for (let i = 0; i < room.seats.length; i++) {
            if (room.seats[i] && room.seats[i].userId === userId) {
                console.log(`[ANTI-ROBO] Eliminando asiento [${i}] del usuario '${user.username}' para prevenir robo de identidad.`);
                room.seats[i] = null;
            }
        }
        
        // 2. Limpiamos también por playerName para casos extremos
        for (let i = 0; i < room.seats.length; i++) {
            if (room.seats[i] && room.seats[i].playerName === user.username) {
                console.log(`[ANTI-ROBO] Eliminando asiento [${i}] por nombre duplicado '${user.username}'.`);
                room.seats[i] = null;
            }
        }
        // --- FIN DE LA LÓGICA ANTI-ROBO ---

        // 3. VALIDACIÓN MEJORADA: Solo prevenir entrada si hay 4 jugadores activos
        if (room.state === 'playing') {
            const activePlayers = room.seats.filter(s => s && s.active !== false).length;
            if (activePlayers >= 4) {
                console.log(`[ANTI-ROBO] Bloqueando entrada de '${user.username}' - Mesa llena con ${activePlayers} jugadores activos.`);
                return socket.emit('joinError', 'La mesa está llena. Espera a que termine la partida.');
            }
        }

    if (room.kickedPlayers && room.kickedPlayers.has(socket.id)) {
        return socket.emit('joinError', 'No puedes unirte a esta mesa porque has sido expulsado.');
    }

    const emptySeatIndex = room.seats.findIndex(seat => seat === null);

    if (emptySeatIndex === -1) {
        return socket.emit('joinError', 'La mesa está llena.');
    }

    if (!room.players) room.players = [];
    room.players.push({ id: socket.id, name: user.username });

    const isWaitingForNextGame = room.state === 'playing' || room.state === 'post-game';

    const roomBet = room.settings.bet;
    const roomPenalty = room.settings.penalty || 0;
    const roomCurrency = room.settings.betCurrency;
    
    // Intentar obtener playerInfo de múltiples fuentes
    let playerInfo = users[userId];
    
    // Si no se encuentra con userId, intentar con username directamente
    if (!playerInfo && user.username) {
        const usernameKey = user.username.toLowerCase();
        playerInfo = users[usernameKey];
        if (playerInfo) {
            // Si se encontró con username, actualizar la referencia con userId
            users[userId] = playerInfo;
        }
    }
    
    // Si aún no se encuentra, intentar obtener desde connectedUsers
    if (!playerInfo && connectedUsers[socket.id]) {
        const connectedUser = connectedUsers[socket.id];
        const connectedUsername = connectedUser.username?.toLowerCase();
        if (connectedUsername) {
            const connectedUserId = 'user_' + connectedUsername;
            playerInfo = users[connectedUserId] || users[connectedUsername];
        }
    }
    
    // Si aún no se encuentra, intentar recargar desde la base de datos
    if (!playerInfo && user.username) {
        try {
            console.log(`[joinRoom] Usuario no encontrado en memoria, intentando recargar desde BD: ${user.username}`);
            const userData = await getUserByUsername(user.username);
            if (userData) {
                // Guardar en users con userId para futuras búsquedas
                users[userId] = userData;
                // También guardar con username por si acaso
                users[user.username.toLowerCase()] = userData;
                playerInfo = userData;
                console.log(`[joinRoom] ✅ Usuario recargado desde BD: ${userId}, créditos: ${userData.credits}, moneda: ${userData.currency}`);
            } else {
                console.error(`[joinRoom] ❌ Usuario no encontrado en BD: ${user.username}`);
            }
        } catch (error) {
            console.error(`[joinRoom] Error al recargar usuario desde BD:`, error);
        }
    }
    
    // Validar que playerInfo existe ANTES de usarlo
    if (!playerInfo) {
        console.error(`[joinRoom] ERROR: playerInfo no encontrado para userId: ${userId}, username: ${user.username}`);
        console.error(`[joinRoom] Usuarios disponibles: ${Object.keys(users).join(', ')}`);
        console.error(`[joinRoom] connectedUsers[socket.id]:`, connectedUsers[socket.id]);
        console.error(`[joinRoom] socket.userId:`, socket.userId);
        return socket.emit('joinError', 'Error: Usuario no encontrado. Por favor, recarga la página.');
    }
    
    // Asegurar que playerInfo tenga todas las propiedades necesarias
    if (!playerInfo.credits && playerInfo.credits !== 0) {
        playerInfo.credits = 0;
        console.warn(`[joinRoom] playerInfo.credits no definido, estableciendo a 0 para ${userId}`);
    }
    if (!playerInfo.currency) {
        playerInfo.currency = roomCurrency || 'USD';
        console.warn(`[joinRoom] playerInfo.currency no definido, estableciendo a ${playerInfo.currency} para ${userId}`);
    }

    // Calculamos el requisito total (apuesta + multa) en la moneda de la mesa
    const totalRequirementInRoomCurrency = roomBet + roomPenalty;

    // Convertimos ese requisito total a la moneda del jugador
    const requiredAmountInPlayerCurrency = convertCurrency(totalRequirementInRoomCurrency, roomCurrency, playerInfo.currency, exchangeRates);

    if (playerInfo.credits < requiredAmountInPlayerCurrency) {
        const friendlyBet = convertCurrency(roomBet, roomCurrency, playerInfo.currency, exchangeRates);
        const friendlyPenalty = convertCurrency(roomPenalty, roomCurrency, playerInfo.currency, exchangeRates);
        return socket.emit('joinError', `Créditos insuficientes. Necesitas ${requiredAmountInPlayerCurrency.toFixed(2)} ${playerInfo.currency} para cubrir la apuesta (${friendlyBet.toFixed(2)}) y la posible multa (${friendlyPenalty.toFixed(2)}).`);
    }

    room.seats[emptySeatIndex] = {
        playerId: socket.id,
        playerName: user.username,
        avatar: user.userAvatar,
        active: !isWaitingForNextGame,
        doneFirstMeld: false,
        status: isWaitingForNextGame ? 'waiting' : undefined,
        userId: userId // Usamos el userId generado por el servidor
    };

    // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AQUÍ ▼▼▼
    // Si un jugador se une durante la fase de revancha, actualizamos el estado para todos.
    if (room.state === 'post-game') {
        console.log(`Un nuevo jugador (${user.username}) se ha unido durante la revancha. Actualizando estado...`);

        // Recalculamos quiénes están listos (incluyendo al nuevo jugador que tiene status: 'waiting')
        const readyPlayerIds = new Set();
        room.rematchRequests.forEach(id => readyPlayerIds.add(id));
        room.seats.forEach(seat => {
            if (seat && seat.status === 'waiting') {
                readyPlayerIds.add(seat.playerId);
            }
        });
        const playersReadyNames = Array.from(readyPlayerIds).map(id => {
            const seat = room.seats.find(s => s && s.playerId === id);
            return seat ? seat.playerName : null;
        }).filter(Boolean);
        const totalPlayersReady = readyPlayerIds.size;

        // Notificamos a todos en la sala para que la UI se actualice instantáneamente.
        io.to(roomId).emit('rematchUpdate', {
            playersReady: playersReadyNames,
            canStart: totalPlayersReady >= 2,
            hostId: room.hostId
        });
    }
    // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

    // ▼▼▼ VERIFICAR NUEVAMENTE SI FUE ELIMINADO ANTES DE UNIRSE A LA SALA ▼▼▼
    // Esta verificación adicional previene que el jugador se una si fue eliminado
    const eliminatedKeyCheck = `${roomId}_${userId}`;
    if (la51EliminatedPlayers[eliminatedKeyCheck]) {
        const eliminationInfo = la51EliminatedPlayers[eliminatedKeyCheck];
        console.log(`[${roomId}] ⚠️ Jugador ${user.username} (${userId}) intenta unirse pero fue eliminado por inactividad. Mostrando modal de falta.`);
        
        // Enviar evento playerEliminated con toda la información para que vea el modal igual que los demás
        socket.emit('playerEliminated', {
            playerId: socket.id,
            playerName: eliminationInfo.playerName || user.username,
            reason: eliminationInfo.reason || 'Abandono por inactividad',
            faultData: eliminationInfo.faultData || { reason: 'Abandono por inactividad' },
            redirect: true, // Redirigir al lobby después de mostrar el modal
            penaltyInfo: eliminationInfo.penaltyInfo
        });
        
        // Limpiar la entrada después de enviar el evento
        delete la51EliminatedPlayers[eliminatedKeyCheck];
        
        return; // No permitir que se una a la sala
    }
    // ▲▲▲ FIN DE VERIFICACIÓN ADICIONAL ▲▲▲
    
    socket.join(roomId);
    
    // ▼▼▼ CAMBIAR ESTADO A "JUGANDO" ▼▼▼
    if (connectedUsers[socket.id]) {
        connectedUsers[socket.id].status = 'Jugando';
        broadcastUserListUpdate(io);
    }
    // ▲▲▲ FIN: BLOQUE AÑADIDO ▲▲▲
    
    // ▼▼▼ AÑADE ESTA LÍNEA AQUÍ ▼▼▼
    socket.currentRoomId = roomId; // Guardamos en la conexión la sala actual del jugador.

    if (isWaitingForNextGame) {
        socket.emit('joinedAsSpectator', getSanitizedRoomForClient(room));
    } else {
        socket.emit('joinedRoomSuccessfully', getSanitizedRoomForClient(room));
    }

    socket.emit('chatHistory', room.chatHistory);
    io.to(roomId).emit('playerJoined', getSanitizedRoomForClient(room));
    broadcastRoomListUpdate(io);

    console.log(`Jugador ${user.username} (ID: ${userId}) se sentó en la mesa ${roomId}.`);
  });


  socket.on('startGame', (roomId) => {
    console.log(`[startGame] Recibida solicitud para iniciar partida en sala ${roomId} desde socket ${socket.id}`);
    const room = la51Rooms[roomId];
    
    if (!room) {
        console.error(`[startGame] ERROR: Sala ${roomId} no encontrada`);
        return socket.emit('joinError', 'La sala no existe.');
    }
    
    console.log(`[startGame] Sala encontrada. hostId: ${room.hostId}, socket.id: ${socket.id}, ¿Es host?: ${room.hostId === socket.id}`);
    
    if (room.hostId !== socket.id) {
        console.error(`[startGame] ERROR: Socket ${socket.id} no es el host. Host real: ${room.hostId}`);
        return socket.emit('joinError', 'Solo el anfitrión puede iniciar el juego.');
    }
    
    if (room.state !== 'waiting') {
        console.error(`[startGame] ERROR: La sala ya está en estado: ${room.state}`);
        return socket.emit('joinError', 'El juego ya ha comenzado.');
    }
    
    const seatedPlayers = room.seats.filter(s => s !== null);
    if (seatedPlayers.length < 2) {
        console.error(`[startGame] ERROR: No hay suficientes jugadores. Jugadores sentados: ${seatedPlayers.length}`);
        return socket.emit('joinError', 'Se necesitan al menos 2 jugadores para iniciar la partida.');
    }
    
    console.log(`[startGame] ✅ Validaciones pasadas. Iniciando juego en la mesa ${roomId} con ${seatedPlayers.length} jugadores`);
    
        room.state = 'playing';
        if (!room.chatHistory) room.chatHistory = [];
        room.chatHistory.push({ sender: 'Sistema', message: 'Ha comenzado una nueva partida.' });
        room.initialSeats = JSON.parse(JSON.stringify(room.seats.filter(s => s !== null))); // Guardamos quiénes empezaron
        room.melds = [];
    room.pot = 0; // Inicializar el bote
    room.penaltiesPaid = {}; // Rastrear multas pagadas: { userId: { playerName, amount, reason } }
        
        room.seats.forEach(async (seat) => {
            if (seat) {
                seat.active = true;
                seat.doneFirstMeld = false;

                const playerInfo = users[seat.userId];
                if (playerInfo) {
                    const roomBet = room.settings.bet;
                    const roomCurrency = room.settings.betCurrency;

                    // Convertir la apuesta a la moneda del jugador para descontarla
                    const betInPlayerCurrency = convertCurrency(roomBet, roomCurrency, playerInfo.currency, exchangeRates);

                    playerInfo.credits -= betInPlayerCurrency;
                    
                    // ▼▼▼ LÍNEA AÑADIDA: Guardar en la Base de Datos ▼▼▼
                    await updateUserCredits(seat.userId, playerInfo.credits, playerInfo.currency);
                    // ▲▲▲ FIN DE LA LÍNEA AÑADIDA ▲▲▲

                    // El bote siempre se mantiene en la moneda de la mesa
                    room.pot += roomBet;

                    io.to(seat.playerId).emit('userStateUpdated', playerInfo);
                }
            }
        });
    
    // Emitir bote inicial a todos los jugadores después de que todas las apuestas se hayan sumado
    io.to(roomId).emit('potUpdated', { newPotValue: room.pot, isPenalty: false });
    console.log(`[${roomId}] 💰 Bote inicial: ${room.pot} ${room.settings.betCurrency} (${seatedPlayers.length} apuestas de ${room.settings.bet} cada una)`);
        
        const newDeck = buildDeck();
        shuffle(newDeck);
        seatedPlayers.forEach(player => {
            room.playerHands[player.playerId] = newDeck.splice(0, 14);
        });

        const startingPlayerId = seatedPlayers[0].playerId;
        room.playerHands[startingPlayerId].push(newDeck.shift());
        
        // --- LÍNEA A AÑADIR ---
        room.hasDrawn = true; // El primer jugador ya "robó" su carta inicial.
        // --- FIN DE LA CORRECCIÓN ---

        room.discardPile = [newDeck.shift()];
        room.deck = newDeck;
        room.currentPlayerId = startingPlayerId;

    const startingPlayerSeat = room.seats.find(s => s && s.playerId === startingPlayerId);
    if (startingPlayerSeat && startingPlayerSeat.isBot) {
        setTimeout(() => botPlay(room, startingPlayerId, io), 1000);
    } else {
        // Iniciar timeout usando la lógica de Ludo (copiada exactamente)
        const startingPlayerSeat = room.seats.find(s => s && s.playerId === startingPlayerId);
        if (startingPlayerSeat && startingPlayerSeat.userId) {
            const newTimeoutKey = `${roomId}_${startingPlayerSeat.userId}`;
            const alreadyPenalized = (room.penaltyApplied && room.penaltyApplied[startingPlayerSeat.userId]);
            if (!alreadyPenalized) {
                if (la51InactivityTimeouts[newTimeoutKey]) {
                    clearTimeout(la51InactivityTimeouts[newTimeoutKey]);
                    delete la51InactivityTimeouts[newTimeoutKey];
                }
                const newTimeoutKeyByPlayerId = `${roomId}_${startingPlayerId}`;
                if (la51InactivityTimeouts[newTimeoutKeyByPlayerId]) {
                    clearTimeout(la51InactivityTimeouts[newTimeoutKeyByPlayerId]);
                    delete la51InactivityTimeouts[newTimeoutKeyByPlayerId];
                }
                Object.keys(la51InactivityTimeouts).forEach(key => {
                    if (key.startsWith(`${roomId}_`) && (key.includes(startingPlayerSeat.userId) || key.includes(startingPlayerId))) {
                        clearTimeout(la51InactivityTimeouts[key]);
                        delete la51InactivityTimeouts[key];
                    }
                });
                la51InactivityTimeouts[newTimeoutKey] = setTimeout(() => {
                    const currentRoom = la51Rooms[roomId];
                    if (!currentRoom || currentRoom.currentPlayerId !== startingPlayerId) {
                        const currentSeat = currentRoom.seats.find(s => s && s.userId === startingPlayerSeat.userId);
                        if (!currentSeat || currentRoom.currentPlayerId !== currentSeat.playerId) {
                            delete la51InactivityTimeouts[newTimeoutKey];
                            return;
                        }
                    }
                    const currentSeat = currentRoom.seats.find(s => s && s.userId === startingPlayerSeat.userId);
                    if (!currentSeat || currentSeat.userId !== startingPlayerSeat.userId) {
                        delete la51InactivityTimeouts[newTimeoutKey];
                        return;
                    }
                    if (!currentRoom.penaltyApplied) currentRoom.penaltyApplied = {};
                    currentRoom.penaltyApplied[currentSeat.userId] = true;
                    let playerIdToUse = currentSeat.playerId;
                    if (!playerIdToUse && currentSeat.userId) {
                        for (const [socketId, socket] of io.sockets.sockets.entries()) {
                            const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                            if (socketUserId === currentSeat.userId) {
                                playerIdToUse = socketId;
                                break;
                            }
                        }
                    }
                    if (playerIdToUse) {
                        handlePlayerDeparture(roomId, playerIdToUse, io, true);
                    }
                    delete la51InactivityTimeouts[newTimeoutKey];
                }, LA51_INACTIVITY_TIMEOUT_MS);
            }
        }
    }

        const playerHandCounts = {};
        seatedPlayers.forEach(player => {
            playerHandCounts[player.playerId] = room.playerHands[player.playerId].length;
        });

        // ▼▼▼ AÑADE ESTE BLOQUE AQUÍ ▼▼▼
        // Notifica a TODOS en la sala (jugadores y espectadores) que reseteen su chat y lista de espectadores.
        io.to(roomId).emit('resetForNewGame', { 
            spectators: room.spectators || [] // Envía la lista de espectadores actualizada
        });
        // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

        seatedPlayers.forEach(player => {
        const isStartingPlayer = player.playerId === startingPlayerId;
            io.to(player.playerId).emit('gameStarted', {
                hand: room.playerHands[player.playerId],
                discardPile: room.discardPile,
                seats: room.seats,
                currentPlayerId: room.currentPlayerId,
                playerHandCounts: playerHandCounts,
            melds: room.melds, // <-- AÑADE ESTA LÍNEA
            isFirstTurn: isStartingPlayer && !startingPlayerSeat.isBot // Indicar si es el primer turno
            });
        });
    
    // ▼▼▼ MENSAJE PARA EL JUGADOR QUE INICIA ▼▼▼
    // Enviar mensaje informativo al jugador que inicia (si no es bot)
    // IMPORTANTE: Enviar con un delay mayor para asegurar que el listener y el DOM estén listos
    if (startingPlayerSeat && !startingPlayerSeat.isBot) {
        console.log(`[startGame] Enviando firstTurnInfo a ${startingPlayerSeat.playerName} (${startingPlayerId})`);
        setTimeout(() => {
            io.to(startingPlayerId).emit('firstTurnInfo', {
                message: '¡Es tu primer turno! Empiezas con 15 cartas. Debes descartar una carta para comenzar el juego.',
                playerName: startingPlayerSeat.playerName
            });
            console.log(`[startGame] ✅ firstTurnInfo enviado a ${startingPlayerSeat.playerName}`);
        }, 1500); // Delay aumentado a 1500ms para asegurar que todo esté listo
    }
    // ▲▲▲ FIN DEL MENSAJE ▲▲▲
        
        console.log(`Partida iniciada en ${roomId}. Bote inicial: ${room.pot}.`);
        // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
        io.to(roomId).emit('potUpdated', { newPotValue: room.pot, isPenalty: false });
        // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
        broadcastRoomListUpdate(io);
  });

  socket.on('meldAction', async (data) => {
    // AÑADE ESTA LÍNEA AL INICIO DE LA FUNCIÓN
    let highlightInfo = null;
    const { roomId, cardIds, targetMeldIndex } = data;
    const room = la51Rooms[roomId];
    const playerSeat = room.seats.find(s => s && s.playerId === socket.id);

    if (!room || !playerSeat || room.currentPlayerId !== socket.id) {
        return console.log('Acción de meld inválida: fuera de turno o jugador no encontrado.');
    }
    
    // Cancelar timeout de inactividad: el jugador está actuando (igual que en Ludo)
    const timeoutKeyByPlayerId = `${roomId}_${socket.id}`;
    const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
    const timeoutKeyByUserId = socketUserId ? `${roomId}_${socketUserId}` : null;
    if (la51InactivityTimeouts[timeoutKeyByPlayerId]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerId]);
        delete la51InactivityTimeouts[timeoutKeyByPlayerId];
    }
    if (timeoutKeyByUserId && la51InactivityTimeouts[timeoutKeyByUserId]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByUserId]);
        delete la51InactivityTimeouts[timeoutKeyByUserId];
    }
    Object.keys(la51InactivityTimeouts).forEach(key => {
        if (key.startsWith(`${roomId}_`) && (key.includes(socket.id) || (socketUserId && key.includes(socketUserId)))) {
            clearTimeout(la51InactivityTimeouts[key]);
            delete la51InactivityTimeouts[key];
        }
    });


    // V --- AÑADE ESTA VALIDACIÓN AQUÍ --- V
    if (!room.hasDrawn) {
        const reason = 'Intentó bajar una combinación sin haber robado una carta primero.';
        console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
        return handlePlayerElimination(room, socket.id, reason, io);
    }
    // ^ --- FIN DE LA VALIDACIÓN --- ^

    const playerHand = room.playerHands[socket.id];
    const cards = cardIds.map(id => playerHand.find(c => c.id === id)).filter(Boolean);

    
if (cards.length !== cardIds.length) {
        return console.log('Falta: El jugador intentó bajar cartas que no tiene.');
    }

    // --- LÓGICA PARA AÑADIR A UN MELD EXISTENTE (PERMANENTE) ---
    if (typeof targetMeldIndex !== 'undefined') {

        // ▼▼▼ AÑADE ESTE BLOQUE DE VALIDACIÓN AQUÍ ▼▼▼
        // NUEVA REGLA: Si robó del descarte, no puede añadir a un juego existente
        // antes de haber bajado un nuevo juego con la carta robada.
        if (room.drewFromDiscard && room.discardCardRequirementMet === false) {
            const reason = 'Robó del descarte pero intentó añadir una carta a un juego existente antes de bajar la combinación obligatoria.';
            console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
            return handlePlayerElimination(room, socket.id, reason, io);
        }
        // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

        if (cards.length !== 1) {
            return io.to(socket.id).emit('fault', { reason: 'Solo puedes añadir una carta a la vez.' });
        }
        if (!playerSeat.doneFirstMeld && room.turnPoints < 51) {
            const reason = 'Intentó añadir una carta a un juego existente sin haber cumplido el requisito de 51 puntos en su bajada inicial.';
            console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
            return handlePlayerElimination(room, socket.id, reason, io);
        }

        // Notificar a todos para animar la adición de la carta
        io.to(roomId).emit('animateCardAdd', {
            melderId: socket.id,
            card: cards[0],
            targetMeldIndex: targetMeldIndex
        });

        io.to(roomId).emit('playSound', 'add'); // <--- AÑADE ESTA LÍNEA AQUÍ
        const targetMeld = room.melds[targetMeldIndex];
        
        // --- INICIO DE LA CORRECCIÓN ---
        // Usamos la nueva función inteligente para saber dónde va la carta.
        const addPosition = targetMeld ? canBeAddedToServerMeld(cards[0], targetMeld) : false;

        if (addPosition === 'prepend') {
            // 'prepend' significa que la añadimos al PRINCIPIO del array.
            targetMeld.cards.unshift(cards[0]);
        } else if (addPosition === 'append') {
            // 'append' significa que la añadimos al FINAL del array.
            targetMeld.cards.push(cards[0]);
        } else {
            // Si la función devuelve 'false', la jugada es inválida.
            // ¡¡¡ ESTA ES LA MODIFICACIÓN SOLICITADA !!!
            // En lugar de solo enviar un 'fault', se considera una falta grave.

            const faultDetails = {
                reason: 'Intento de añadir una carta incorrecta a un juego en mesa.',
                faultType: 'invalid_add', // <-- NUEVA BANDERA PARA EL CLIENTE
                invalidCards: [cards[0]], // La carta que intentó añadir
                contextCards: targetMeld.cards, // El juego al que intentó añadirla
                explanation: 'La carta no pertenece a este grupo o escalera.'
            };
            
            console.log(`FALTA GRAVE: Jugador ${socket.id} - ${faultDetails.reason}`);
            
            // Se llama a la función de eliminación.
            return handlePlayerElimination(room, socket.id, faultDetails, io);
        }
        // YA NO SE REORDENA NADA. La carta ya está en su sitio correcto.
        // --- FIN DE LA CORRECCIÓN ---

        // Guardamos la información de la carta a resaltar para enviarla más tarde.
        highlightInfo = {
            cardId: cards[0].id,
            meldIndex: targetMeldIndex
        };

    }
    // --- LÓGICA PARA BAJAR UNA NUEVA COMBINACIÓN (TEMPORAL) ---
    else {
        // REGLA: Si el jugador robó del descarte y aún no ha cumplido el requisito de usar la carta...
        if (room.drewFromDiscard && room.discardCardRequirementMet === false) {
            // ...entonces esta combinación DEBE contener la carta robada.
            const cardIsPresentInMeld = cards.some(c => c.id === room.drewFromDiscard.id);

            if (!cardIsPresentInMeld) {
                // Si no la contiene, es una falta grave.
                const reason = 'Robó del descarte y no usó la carta en su primera combinación.';
                console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
                return handlePlayerElimination(room, socket.id, reason, io);
            } else {
                // Si la contiene, el requisito ya se ha cumplido para el resto del turno.
                console.log(`Jugador ${socket.id} ha cumplido el requisito de la carta de descarte.`);
                room.discardCardRequirementMet = true;
            }
        }

        // Notificar a todos para animar la nueva combinación
        const meldType = validateMeld(cards);
        if (!meldType) {
            const analysis = analyzeAndSuggestCorrection(cards);
            const faultDetails = {
                reason: 'Intento de bajar una combinación de cartas inválida.',
                invalidCards: cards,
                correctCards: analysis.suggestion,
                explanation: analysis.explanation
            };
            return handlePlayerElimination(room, socket.id, faultDetails, io);
        }

        io.to(roomId).emit('playSound', 'meld'); // <--- AÑADE ESTA LÍNEA AQUÍ
        io.to(roomId).emit('animateNewMeld', {
            melderId: socket.id,
            cards: cards
        });

        const meldPoints = calculateMeldPoints(cards, meldType);

        // Añadimos la combinación y los puntos al estado temporal del turno
        room.turnMelds.push({
            cards: cards,
            type: meldType,
            points: meldPoints,
            melderId: socket.id
        });
        room.turnPoints += meldPoints;
    }

    // --- LÓGICA COMÚN: ACTUALIZAR MANO Y NOTIFICAR ---
    const meldedCardIds = new Set(cardIds);
    room.playerHands[socket.id] = playerHand.filter(card => !meldedCardIds.has(card.id));

    // ▼▼▼ AÑADE ESTE BLOQUE DE VALIDACIÓN AQUÍ ▼▼▼
    // NUEVA REGLA: Si un jugador se queda sin cartas después de bajar, es una falta.
    if (room.playerHands[socket.id].length === 0) {
        const reason = 'Se quedó sin cartas al bajar y no puede descartar para ganar. Es obligatorio ganar descartando la última carta.';
        console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
        // Detenemos la ejecución aquí y eliminamos al jugador.
        return handlePlayerElimination(room, socket.id, reason, io);
    }
    // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

    const playerHandCounts = {};
    room.seats.filter(s => s).forEach(p => {
        playerHandCounts[p.playerId] = room.playerHands[p.playerId]?.length || 0;
    });
    
    // Notificamos a todos, enviando tanto las combinaciones permanentes como las temporales
    io.to(roomId).emit('meldUpdate', {
        newMelds: room.melds,
        turnMelds: room.turnMelds,
        playerHandCounts: playerHandCounts,
        highlight: highlightInfo // <--- LÍNEA AÑADIDA
    });

    socket.emit('meldSuccess', { meldedCardIds: cardIds });
    await checkVictoryCondition(room, roomId, io);
  });

socket.on('accionDescartar', async (data) => {
    console.log(`[DEBUG] accionDescartar recibida de ${socket.id}:`, data);
    const { roomId, card } = data;
    const room = la51Rooms[roomId];
    
    console.log(`[DEBUG] Room encontrada:`, !!room);
    
    // Cancelar timeout de inactividad: el jugador está actuando (igual que en Ludo)
    const timeoutKeyByPlayerId = `${roomId}_${socket.id}`;
    const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
    const timeoutKeyByUserId = socketUserId ? `${roomId}_${socketUserId}` : null;
    if (la51InactivityTimeouts[timeoutKeyByPlayerId]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerId]);
        delete la51InactivityTimeouts[timeoutKeyByPlayerId];
    }
    if (timeoutKeyByUserId && la51InactivityTimeouts[timeoutKeyByUserId]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByUserId]);
        delete la51InactivityTimeouts[timeoutKeyByUserId];
    }
    Object.keys(la51InactivityTimeouts).forEach(key => {
        if (key.startsWith(`${roomId}_`) && (key.includes(socket.id) || (socketUserId && key.includes(socketUserId)))) {
            clearTimeout(la51InactivityTimeouts[key]);
            delete la51InactivityTimeouts[key];
        }
    });
    console.log(`[DEBUG] Current player: ${room?.currentPlayerId}, Socket ID: ${socket.id}`);
    
    if (!room || room.currentPlayerId !== socket.id) {
        console.log(`[DEBUG] Salida temprana: room=${!!room}, currentPlayer=${room?.currentPlayerId}, socket=${socket.id}`);
        return;
    }

    
    // Limpiar estado de desconexión si existe
    const userId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
    if (userId) {
        // Limpiar de la lista de desconectados si existe (ya no se usa, pero por si acaso)
        const disconnectKey = `${roomId}_${userId}`;
        if (la51DisconnectedPlayers[disconnectKey]) {
            delete la51DisconnectedPlayers[disconnectKey];
            console.log(`[${roomId}] ✓ Estado de desconexión limpiado para ${userId} (jugador está actuando)`);
        }
        
        // ▼▼▼ CRÍTICO: Cancelar timeout de inactividad cuando el jugador actúa ▼▼▼
        // Si el jugador actúa, puede continuar jugando normalmente
        const timeoutKeyByPlayerIdAction = `${roomId}_${socket.id}`;
        const timeoutKeyByUserIdAction = `${roomId}_${userId}`;
        if (la51InactivityTimeouts[timeoutKeyByPlayerIdAction]) {
            clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerIdAction]);
            delete la51InactivityTimeouts[timeoutKeyByPlayerIdAction];
            console.log(`[${roomId}] ✅ Timeout de inactividad cancelado para ${userId} (jugador está actuando)`);
        }
        if (la51InactivityTimeouts[timeoutKeyByUserIdAction]) {
            clearTimeout(la51InactivityTimeouts[timeoutKeyByUserIdAction]);
            delete la51InactivityTimeouts[timeoutKeyByUserIdAction];
            console.log(`[${roomId}] ✅ Timeout de inactividad cancelado para ${userId} (jugador está actuando)`);
        }
        // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
        Object.keys(la51InactivityTimeouts).forEach(key => {
            if (key.startsWith(`${roomId}_`) && (key.includes(userId) || key.includes(socket.id))) {
                clearTimeout(la51InactivityTimeouts[key]);
                delete la51InactivityTimeouts[key];
                console.log(`[${roomId}] ✅ Timeout adicional cancelado para ${userId} (jugador está actuando): ${key}`);
            }
        });
        // ▲▲▲ FIN CANCELACIÓN DE TIMEOUT AL ACTUAR ▲▲▲
        
        // Notificar que el jugador se reconectó (si estaba desconectado)
        if (la51DisconnectedPlayers[disconnectKey]) {
            io.to(roomId).emit('playerReconnected', {
                playerName: playerSeat?.playerName,
                message: `${playerSeat?.playerName} se ha reconectado.`
            });
        }
    }
    // ▲▲▲ FIN CANCELACIÓN TIMEOUT Y LIMPIEZA DE DESCONEXIÓN ▲▲▲

    const playerSeat = room.seats.find(s => s && s.playerId === socket.id);
    console.log(`[DEBUG] Player seat encontrado:`, !!playerSeat);
    if (!playerSeat) return;

    const playerHand = room.playerHands[socket.id];
    console.log(`[DEBUG] Player hand length:`, playerHand?.length);
    console.log(`[DEBUG] Card to discard:`, card);

    // << --- INICIO DE LA NUEVA CORRECCIÓN --- >>
    // REGLA CRÍTICA: Si el jugador robó del MAZO y ha bajado combinaciones en este turno, está obligado a ganar.
    if (!room.drewFromDiscard && room.turnMelds.length > 0) {
        // Si después de bajar, su mano no queda vacía (es decir, no ha ganado), es una falta.
        // Se comprueba `playerHand.length > 1` porque la carta a descartar aún está en la mano.
        if (playerHand.length > 1) {
            const reason = 'Robó del mazo, bajó un juego y no ganó en el mismo turno.';
            console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
            return handlePlayerElimination(room, socket.id, reason, io);
        }
    }
    // << --- FIN DE LA NUEVA CORRECCIÓN --- >>

    // REGLA 1 (CORREGIDA): El jugador debe haber robado, A MENOS QUE SEA SU PRIMER TURNO.
    // El primer turno se identifica por: tiene 15 cartas O ya se marcó hasDrawn al iniciar el juego
    const isFirstTurn = playerHand.length === 15 || (room.hasDrawn && room.turnMelds.length === 0 && !room.drewFromDiscard);
    if (!room.hasDrawn && !isFirstTurn) {
        const reason = 'Intentó descartar una carta sin haber robado primero.';
        console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
        return handlePlayerElimination(room, socket.id, reason, io);
    }

    // REGLA 2: Si robó del descarte, es OBLIGATORIO bajar al menos una combinación.
    if (room.drewFromDiscard) {
        // La validación de que usó la carta robada ya está en 'meldAction'.
        // Aquí solo nos aseguramos de que no pueda robar y descartar directamente sin bajar.
        if (room.turnMelds.length === 0) {
            const reason = 'Robó del descarte y no bajó ninguna combinación.';
            console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
            return handlePlayerElimination(room, socket.id, reason, io);
        }
    }

    // ▼▼▼ REEMPLAZA EL BLOQUE DE LA REGLA 3 CON ESTE CÓDIGO ▼▼▼

    // REGLA 3: Descarte ilegal (CORREGIDA Y MEJORADA).
    const isWinningDiscard = playerHand.length === 1;

    // La validación solo se activa si NO es el descarte para ganar.
    if (!isWinningDiscard) {
        // Se comprueba contra TODAS las combinaciones en la mesa (las permanentes y las de este turno).
        const allCurrentMelds = [...room.melds, ...room.turnMelds];

        if (allCurrentMelds.length > 0) {
            for (const meld of allCurrentMelds) {
                if (canBeAddedToServerMeld(card, meld)) {
                    // ESTE ES EL BLOQUE A REEMPLAZAR
                    const faultDetails = {
                        reason: `Descarte ilegal. La carta se podía añadir a un juego en mesa.`,
                        invalidCards: [card],
                        contextCards: meld.cards,
                        explanation: meld.type === 'escalera' 
                            ? 'Esta carta no se puede descartar porque pertenece a la misma secuencia y palo que el juego en mesa.'
                            : 'Esta carta no se puede descartar porque completa un grupo válido en mesa.'
                    };
                    return handlePlayerElimination(room, socket.id, faultDetails, io);
                }
            }
        }
    }
    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲

    // REGLA 4: Validar 51 puntos (ESTRICTO - CAUSA ELIMINACIÓN).
    // Solo aplica si el jugador ha bajado combinaciones en este turno
    if (!playerSeat.doneFirstMeld && room.turnMelds.length > 0) {
        if (room.turnPoints < 51) {
            // ¡FALTA GRAVE! El jugador intentó descartar sin haber bajado los 51 puntos requeridos.
            const reason = `No cumplió con los 51 puntos requeridos en su primera bajada (solo bajó ${room.turnPoints}).`;
            console.log(`FALTA GRAVE: Jugador ${socket.id} - ${reason}`);
            return handlePlayerElimination(room, socket.id, reason, io);
        } else {
            // Si los puntos son 51 o más, la jugada es válida.
            playerSeat.doneFirstMeld = true;
            room.firstMeldCompletedByAnyone = true;
        }
    }

    // --- SI TODAS LAS REGLAS PASAN, LA JUGADA ES VÁLIDA ---
    console.log(`[DEBUG] Todas las validaciones pasaron, procesando descarte...`);
    const cardIndex = playerHand.findIndex(c => c.id === card.id);
    console.log(`[DEBUG] Card index found:`, cardIndex);
    if (cardIndex === -1) {
        console.log(`[DEBUG] Carta no encontrada en la mano del jugador`);
        return socket.emit('fault', { reason: 'Error de sincronización, la carta no está en tu mano.' });
    }

    // 1. Procesar la jugada.
    console.log(`[DEBUG] Eliminando carta de la mano...`);
    playerHand.splice(cardIndex, 1);
    console.log(`[DEBUG] Agregando carta al descarte...`);
    room.discardPile.push(card);
    console.log(`[DEBUG] Descartar procesado exitosamente`);
    if (room.turnMelds.length > 0) {
        room.melds.push(...room.turnMelds);
    }

    // 2. Comprobar victoria.
    console.log(`[DEBUG] Comprobando condición de victoria...`);
    if (await checkVictoryCondition(room, roomId, io)) {
        console.log(`[DEBUG] Juego terminado por victoria`);
        return;
    }

    // 3. Cambiar turno usando la función helper (esto iniciará el timeout automáticamente)
    console.log(`[DEBUG] Cambiando turno usando advanceTurnAfterAction...`);
    await advanceTurnAfterAction(room, socket.id, card, io);
});


  // ▼▼▼ LISTENER drawFromDeck CON SINCRONIZACIÓN MEJORADA ▼▼▼
  socket.on('drawFromDeck', async (roomId) => { // <-- Se añade 'async'
    const room = la51Rooms[roomId];
    if (!room || room.currentPlayerId !== socket.id) {
        return;
    }
    
    // Cancelar timeout de inactividad: el jugador está actuando (igual que en Ludo)
    const timeoutKeyByPlayerId = `${roomId}_${socket.id}`;
    const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
    const timeoutKeyByUserId = socketUserId ? `${roomId}_${socketUserId}` : null;
    if (la51InactivityTimeouts[timeoutKeyByPlayerId]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerId]);
        delete la51InactivityTimeouts[timeoutKeyByPlayerId];
    }
    if (timeoutKeyByUserId && la51InactivityTimeouts[timeoutKeyByUserId]) {
        clearTimeout(la51InactivityTimeouts[timeoutKeyByUserId]);
        delete la51InactivityTimeouts[timeoutKeyByUserId];
    }
    Object.keys(la51InactivityTimeouts).forEach(key => {
        if (key.startsWith(`${roomId}_`) && (key.includes(socket.id) || (socketUserId && key.includes(socketUserId)))) {
            clearTimeout(la51InactivityTimeouts[key]);
            delete la51InactivityTimeouts[key];
        }
    });

    
    // Limpiar estado de desconexión si existe
    const userId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
    // ▲▲▲ FIN CANCELACIÓN TIMEOUT ▲▲▲

    if (room.hasDrawn) {
        const reason = 'Intento de robar más de una vez en el mismo turno.';
        return handlePlayerElimination(room, socket.id, reason, io);
    }

    if (room.deck.length === 0) {
        if (room.discardPile.length > 1) {
            const topCard = room.discardPile.pop();
            room.deck = room.discardPile;
            shuffle(room.deck);
            room.discardPile = [topCard];
            io.to(roomId).emit('deckShuffled');

            // --- ESTA ES LA CORRECCIÓN CLAVE ---
            // Esperamos 5 segundos (la duración de la animación) ANTES de continuar.
            await new Promise(r => setTimeout(r, 5000));
            
        } else {
            socket.emit('fault', { reason: 'No hay cartas disponibles para robar.' });
            return;
        }
    }
    
    const cardDrawn = room.deck.shift();
    room.playerHands[socket.id].push(cardDrawn);

    const playerHandCounts = {};
    const seatedPlayers = room.seats.filter(s => s !== null);
    seatedPlayers.forEach(player => {
        const hand = room.playerHands[player.playerId];
        playerHandCounts[player.playerId] = hand ? hand.length : 0;
    });

    room.hasDrawn = true;
    
    io.to(roomId).emit('playerDrewCard', {
        playerId: socket.id,
        source: 'deck',
        playerHandCounts: playerHandCounts
    });
    
    // Este evento ahora se enviará DESPUÉS de la pausa y la animación.
    socket.emit('cardDrawn', { 
        card: cardDrawn,
        newDeckSize: room.deck.length,
        newDiscardPile: room.discardPile 
    });

    io.to(roomId).emit('handCountsUpdate', {
        playerHandCounts: playerHandCounts
    });
  });

  // AÑADE este nuevo listener para el robo del descarte
  socket.on('drawFromDiscard', (roomId) => {
      const room = la51Rooms[roomId];
      if (!room || room.currentPlayerId !== socket.id) {
          return;
      }
      
      // Cancelar timeout de inactividad: el jugador está actuando
      cancelLa51InactivityTimeout(roomId, socket.id);


      if (room.hasDrawn) {
          const reason = 'Intento de robar más de una vez en el mismo turno.';
          return handlePlayerElimination(room, socket.id, reason, io);
      }
      if (room.discardPile.length === 0) {
          return;
      }

      const cardDrawn = room.discardPile.pop();
      room.playerHands[socket.id].push(cardDrawn);

      const playerHandCounts = {};
      room.seats.filter(s => s !== null).forEach(p => {
          playerHandCounts[p.playerId] = room.playerHands[p.playerId]?.length || 0;
      });

      room.hasDrawn = true;
      room.drewFromDiscard = cardDrawn;
      
      // Notificar a todos en la sala sobre el robo del descarte
      io.to(roomId).emit('playerDrewCard', {
          playerId: socket.id,
          source: 'discard',
          card: cardDrawn, // Enviamos la carta para que se vea la animación correcta
          newDiscardPile: room.discardPile, // Enviamos el nuevo estado del descarte
          playerHandCounts: playerHandCounts // Enviamos los conteos actualizados
      });
      
      // --- INICIO DE LA CORRECCIÓN ---
      // Activamos la bandera que obliga a usar esta carta.
      room.discardCardRequirementMet = false; 
      // --- FIN DE LA CORRECCIÓN ---
      
      socket.emit('discardCardDrawn', { 
          card: cardDrawn,
          newDiscardPile: room.discardPile 
      });

      io.to(roomId).emit('handCountsUpdate', {
          playerHandCounts: playerHandCounts
      });
  });

  socket.on('playerFault', ({ roomId, faultReason }) => {
    const room = la51Rooms[roomId];
    if (room) {
        handlePlayerElimination(room, socket.id, faultReason, io);
    }
  });

  socket.on('sendGameChat', (data) => {
    const { roomId, message, sender } = data;
    const room = la51Rooms[roomId];
    if (room) {
        const chatMessage = { sender, message };
        // 1. Guardamos el mensaje en el historial de la sala
        if (!room.chatHistory) room.chatHistory = [];
        room.chatHistory.push(chatMessage);
        // 2. Lo enviamos a todos en la sala como antes
        io.to(roomId).emit('gameChat', chatMessage);
    }
  });

  // Chat del lobby de La 51
  socket.on('sendLobbyChat', (data) => {
      if (!data || !data.text || !data.sender) return; // Validación básica

      // Creamos el objeto del mensaje en el servidor para consistencia
      const newMessage = {
          id: `msg-la51-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          from: data.sender,
          text: data.text,
          ts: Date.now()
      };

      // Lo guardamos en el historial específico de La 51
      la51LobbyChatHistory.push(newMessage);
      la51ChatLastMessageTime = Date.now(); // Actualizar timestamp del último mensaje
      if (la51LobbyChatHistory.length > LOBBY_CHAT_HISTORY_LIMIT) {
          la51LobbyChatHistory.shift(); // Eliminamos el mensaje más antiguo si superamos el límite
      }

      // Lo retransmitimos SOLO a los clientes en el lobby de La 51
      // Usamos un namespace o identificador para separar los chats
      io.emit('la51LobbyChatUpdate', newMessage);
  });
  // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

  socket.on('disconnect', () => {
    const username = connectedUsers[socket.id]?.username || socket.userId?.replace(/^user_/, '') || socket.id;
    const userId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
    const roomId = socket.currentRoomId;

    console.log(`❌ Jugador desconectado: ${socket.id}`);
    console.log(`[DEBUG DISCONNECT] 🔍 INICIO DISCONNECT - Usuario: ${username}, userId: ${userId}, roomId: ${roomId}, socket.id: ${socket.id}`);
    try {
        const stackTrace = new Error().stack;
        if (stackTrace) {
            console.log(`[DEBUG DISCONNECT] 🔍 Stack trace:\n${stackTrace}`);
        }
    } catch (err) {
        console.log(`[DEBUG DISCONNECT] 🔍 Stack trace no disponible`);
    }

    // ▼▼▼ CRÍTICO: Verificar si está en una sala de La 51 en estado 'playing' ANTES de eliminar de connectedUsers ▼▼▼
    // Si está en una sala de La 51 en estado 'playing', NO eliminar de connectedUsers todavía - el timeout se encargará de eso
    let shouldKeepInConnectedUsers = false;
    if (roomId && la51Rooms[roomId]) {
        const la51Room = la51Rooms[roomId];
        const seatIndex = la51Room.seats.findIndex(s => s && s.playerId === socket.id);
        if (seatIndex !== -1 && la51Room.state === 'playing') {
            const leavingPlayerSeat = la51Room.seats[seatIndex];
            if (leavingPlayerSeat && leavingPlayerSeat.active !== false && leavingPlayerSeat.status !== 'waiting') {
                // Está en una partida activa de La 51 - NO eliminar de connectedUsers todavía
                shouldKeepInConnectedUsers = true;
                console.log(`[DISCONNECT] ${username || socket.id} se desconectó de La 51 durante partida activa. NO se elimina de connectedUsers todavía. El timeout se encargará de eso.`);
            }
        }
    }
    
    // Verificar también si hay timeout de inactividad activo (para Ludo o La 51)
    let hasActiveInactivityTimeout = false;
    if (roomId && userId && !shouldKeepInConnectedUsers) {
        // Verificar en La 51
        if (la51Rooms[roomId]) {
            const la51TimeoutKeyByPlayerId = `${roomId}_${socket.id}`;
            const la51TimeoutKeyByUserId = `${roomId}_${userId}`;
            hasActiveInactivityTimeout = la51InactivityTimeouts[la51TimeoutKeyByPlayerId] || 
                                        la51InactivityTimeouts[la51TimeoutKeyByUserId];
        }
        // Verificar en Ludo
        if (ludoRooms[roomId]) {
            const ludoTimeoutKey = `${roomId}_${userId}`;
            hasActiveInactivityTimeout = hasActiveInactivityTimeout || ludoInactivityTimeouts[ludoTimeoutKey];
        }
    }
    
    // Solo eliminar de connectedUsers si NO está en una partida activa de La 51 Y NO hay timeout activo
    // Si está en una partida activa de La 51 o hay timeout activo, se eliminará después de que se complete el timeout
    let wasInList = false;
    console.log(`[DEBUG DISCONNECT] 🔍 Verificando eliminación de connectedUsers - shouldKeepInConnectedUsers: ${shouldKeepInConnectedUsers}, hasActiveInactivityTimeout: ${hasActiveInactivityTimeout}, connectedUsers[socket.id]: ${!!connectedUsers[socket.id]}`);
    if (!shouldKeepInConnectedUsers && !hasActiveInactivityTimeout && connectedUsers[socket.id]) {
        wasInList = true;
        console.log(`[DEBUG DISCONNECT] ⚠️⚠️⚠️ ELIMINANDO DE CONNECTEDUSERS ANTES DEL TIMEOUT - Usuario: ${username}, socket.id: ${socket.id}, roomId: ${roomId}`);
        try {
            const stackTrace = new Error().stack;
            if (stackTrace) {
                console.log(`[DEBUG DISCONNECT] ⚠️⚠️⚠️ Stack trace de eliminación:\n${stackTrace}`);
            }
        } catch (err) {
            console.log(`[DEBUG DISCONNECT] ⚠️⚠️⚠️ Stack trace no disponible`);
        }
        delete connectedUsers[socket.id];
    } else if (shouldKeepInConnectedUsers || hasActiveInactivityTimeout) {
        console.log(`[DISCONNECT] ${username || socket.id} se desconectó pero tiene timeout activo o está en partida activa de La 51. NO se elimina de connectedUsers todavía.`);
    }

    // 2. Si estaba en la lista y se eliminó, actualizar inmediatamente (antes de manejar salas)
    if (wasInList) {
        broadcastUserListUpdate(io);
        console.log(`[User List] Usuario ${username || socket.id} eliminado de la lista. Actualización enviada.`);
    }

    // 3. Maneja la lógica de la sala (si estaba en una)
    if (roomId && ludoRooms[roomId]) {
        const room = ludoRooms[roomId];
        const seatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
        const userId = socket.userId;

        if (seatIndex !== -1 && room.state === 'waiting') {
            // ESTABA EN EL LOBBY DE LUDO (ESPERANDO)
            // Liberar asiento inmediatamente sin reserva de reconexión
            const leavingPlayerSeat = room.seats[seatIndex];

            // Limpiar cualquier reconexión pendiente para este usuario
            const timeoutKey = `${roomId}_${userId}`;
            if (ludoReconnectTimeouts[timeoutKey]) {
                clearTimeout(ludoReconnectTimeouts[timeoutKey]);
                delete ludoReconnectTimeouts[timeoutKey];
            }
            
            // Limpiar reconnectSeats si existe
            if (room.reconnectSeats && room.reconnectSeats[userId]) {
                delete room.reconnectSeats[userId];
                if (Object.keys(room.reconnectSeats).length === 0) {
                    delete room.reconnectSeats;
                }
            }

            // Liberar el asiento inmediatamente
            room.seats[seatIndex] = null;

            console.log(`[LUDO DISCONNECT] ${username} se desconectó de la sala ${roomId} (esperando). Asiento liberado inmediatamente.`);

            // Notificar a todos los jugadores en tiempo real que el asiento está libre
            broadcastLudoRoomListUpdate(io);
            
            // Notificar también dentro de la sala para actualización inmediata
            io.to(roomId).emit('playerJoined', ludoGetSanitizedRoomForClient(room));
            
            // Verificar si la sala debe limpiarse
            ludoCheckAndCleanRoom(roomId, io);

        } else if (seatIndex !== -1 && (room.state === 'playing' || room.state === 'post-game')) {
            // ▼▼▼ CORRECCIÓN: El jugador se desconectó durante una partida activa - ESPERAR 2 MINUTOS DE INACTIVIDAD ▼▼▼
            const leavingPlayerSeat = room.seats[seatIndex];
            
            if (leavingPlayerSeat && leavingPlayerSeat.status !== 'waiting') {
                console.log(`[LUDO DISCONNECT] ${username} se desconectó durante partida activa. Esperando 2 minutos de inactividad cuando le toque el turno.`);
                
                // Marcar como desconectado (pero NO eliminar aún)
                const disconnectKey = `${roomId}_${userId}`;
                ludoDisconnectedPlayers[disconnectKey] = {
                    disconnectedAt: Date.now(),
                    seatIndex: seatIndex,
                    playerId: socket.id,
                    userId: userId
                };
                
                // Verificar si es su turno actualmente
                const isCurrentTurn = room.gameState && room.gameState.turn && room.gameState.turn.playerIndex === seatIndex;
                
                // ▼▼▼ CRÍTICO: Verificar si el jugador ya fue eliminado antes de iniciar timeout de desconexión ▼▼▼
                const globalPenaltyKeyForDisconnect = `${roomId}_${userId}`;
                const alreadyEliminated = ludoGlobalPenaltyApplied[globalPenaltyKeyForDisconnect] || 
                                        (room.penaltyApplied && room.penaltyApplied[userId]) ||
                                        (room.abandonmentFinalized && room.abandonmentFinalized[userId]);
                
                if (alreadyEliminated) {
                    console.log(`[LUDO DISCONNECT] ${username} ya fue eliminado por inactividad. NO se inicia nuevo timeout de desconexión.`);
                    // Limpiar estado de desconexión
                    delete ludoDisconnectedPlayers[disconnectKey];
                    return; // NO iniciar timeout si ya fue eliminado
                }
                // ▲▲▲ FIN VERIFICACIÓN DE ELIMINACIÓN ▲▲▲
                
                if (isCurrentTurn) {
                    // Si es su turno, verificar si ya hay un timeout de inactividad activo
                    const inactivityTimeoutKey = `${roomId}_${userId}`;
                    const hasActiveInactivityTimeout = ludoInactivityTimeouts[inactivityTimeoutKey];
                    
                    if (hasActiveInactivityTimeout) {
                        console.log(`[LUDO DISCONNECT] ${username} se desconectó durante su turno, pero ya hay un timeout de inactividad activo. NO se inicia nuevo timeout.`);
                        // NO iniciar nuevo timeout, el existente se encargará de eliminar al jugador
                        return;
                    }
                    
                    // Si NO hay timeout activo, iniciar timeout de inactividad INMEDIATAMENTE
                    console.log(`[LUDO DISCONNECT] ${username} se desconectó durante su turno. Iniciando timeout de inactividad de 2 minutos.`);
                    
                    // ▼▼▼ CRÍTICO: Cancelar TODOS los timeouts posibles (userId y playerId) para asegurar que siempre se espere 2 minutos completos ▼▼▼
                    // Cancelar timeout anterior si existe (por userId)
                    if (ludoInactivityTimeouts[inactivityTimeoutKey]) {
                        clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKey]);
                        delete ludoInactivityTimeouts[inactivityTimeoutKey];
                        console.log(`[LUDO DISCONNECT] Timeout anterior cancelado para ${username} (userId: ${userId})`);
                    }
                    // Cancelar timeout anterior si existe (por playerId/socket.id)
                    const inactivityTimeoutKeyByPlayerId = `${roomId}_${socket.id}`;
                    if (ludoInactivityTimeouts[inactivityTimeoutKeyByPlayerId]) {
                        clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKeyByPlayerId]);
                        delete ludoInactivityTimeouts[inactivityTimeoutKeyByPlayerId];
                        console.log(`[LUDO DISCONNECT] Timeout anterior cancelado para ${username} (playerId: ${socket.id})`);
                    }
                    // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
                    Object.keys(ludoInactivityTimeouts).forEach(key => {
                        if (key.startsWith(`${roomId}_`) && (key.includes(userId) || key.includes(socket.id))) {
                            clearTimeout(ludoInactivityTimeouts[key]);
                            delete ludoInactivityTimeouts[key];
                            console.log(`[LUDO DISCONNECT] Timeout adicional cancelado: ${key}`);
                        }
                    });
                    // ▲▲▲ FIN CANCELACIÓN DE TODOS LOS TIMEOUTS ▲▲▲
                    
                    // Iniciar nuevo timeout de inactividad (SIEMPRE 2 minutos completos desde ahora)
                    ludoInactivityTimeouts[inactivityTimeoutKey] = setTimeout(() => {
                        console.log(`[LUDO DISCONNECT TIMEOUT] ⏰ Han pasado 2 minutos desde que ${username} se desconectó. Eliminando por abandono.`);
                        
                        // Verificar que el jugador sigue desconectado
                        const currentRoom = ludoRooms[roomId];
                        if (!currentRoom) {
                            delete ludoInactivityTimeouts[inactivityTimeoutKey];
                            delete ludoDisconnectedPlayers[disconnectKey];
                            return;
                        }
                        
                        // Verificar que el jugador todavía está marcado como desconectado
                        if (!ludoDisconnectedPlayers[disconnectKey]) {
                            console.log(`[LUDO DISCONNECT TIMEOUT] ${username} se reconectó antes del timeout. No se elimina.`);
                            delete ludoInactivityTimeouts[inactivityTimeoutKey];
                            return;
                        }
                        
                        // Verificar que el turno todavía es de este jugador
                        const currentTurnIndex = currentRoom.gameState && currentRoom.gameState.turn ? currentRoom.gameState.turn.playerIndex : -1;
                        if (currentTurnIndex !== seatIndex) {
                            console.log(`[LUDO DISCONNECT TIMEOUT] El turno ya cambió. No se elimina al jugador por inactividad.`);
                            delete ludoInactivityTimeouts[inactivityTimeoutKey];
                            delete ludoDisconnectedPlayers[disconnectKey];
                            return;
                        }
                        
                        // Verificar que el jugador todavía está en la sala (puede estar desconectado, pero el asiento debe existir)
                        const currentSeatAtIndex = currentRoom.seats[seatIndex];
                        if (!currentSeatAtIndex) {
                            console.log(`[LUDO DISCONNECT TIMEOUT] El asiento ${seatIndex} ya está vacío. No se elimina.`);
                            delete ludoInactivityTimeouts[inactivityTimeoutKey];
                            delete ludoDisconnectedPlayers[disconnectKey];
                            return;
                        }
                        
                        // Verificar que es el mismo jugador por userId
                        if (!currentSeatAtIndex.userId || currentSeatAtIndex.userId !== leavingPlayerSeat.userId) {
                            console.log(`[LUDO DISCONNECT TIMEOUT] El jugador en el asiento ${seatIndex} ya no es el mismo. No se elimina.`);
                            delete ludoInactivityTimeouts[inactivityTimeoutKey];
                            delete ludoDisconnectedPlayers[disconnectKey];
                            return;
                        }
                        
                        // ▼▼▼ CRÍTICO: REGISTRAR PENALIZACIÓN GLOBAL Y abandonmentFinalized ANTES DE ELIMINAR ▼▼▼
                        if (currentSeatAtIndex.userId) {
                            const globalPenaltyKeyForElimination = `${roomId}_${currentSeatAtIndex.userId}`;
                            ludoGlobalPenaltyApplied[globalPenaltyKeyForElimination] = true;
                            
                            if (!currentRoom.abandonmentFinalized) {
                                currentRoom.abandonmentFinalized = {};
                            }
                            currentRoom.abandonmentFinalized[currentSeatAtIndex.userId] = {
                                reason: 'Abandono por inactividad',
                                penaltyApplied: true,
                                timestamp: Date.now()
                            };
                            
                            if (!currentRoom.penaltyApplied) {
                                currentRoom.penaltyApplied = {};
                            }
                            currentRoom.penaltyApplied[currentSeatAtIndex.userId] = true;
                            console.log(`[${roomId}] ✅ Jugador ${username} registrado en ludoGlobalPenaltyApplied y abandonmentFinalized antes de eliminar por timeout de desconexión.`);
                        }
                        // ▲▲▲ FIN DE REGISTRO DE PENALIZACIÓN GLOBAL ▲▲▲
                        
                        // Eliminar al jugador por abandono (por inactividad de desconexión)
                        // Usar el playerId actual del asiento, o buscar por userId si no existe
                        let playerIdToUse = currentSeatAtIndex.playerId;
                        if (!playerIdToUse) {
                            // Buscar cualquier socket del userId
                            for (const [socketId, socket] of io.sockets.sockets.entries()) {
                                const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                                if (socketUserId === currentSeatAtIndex.userId) {
                                    playerIdToUse = socketId;
                                    break;
                                }
                            }
                        }
                        
                        console.log(`[LUDO DISCONNECT TIMEOUT] 🚨 ELIMINANDO JUGADOR POR DESCONEXIÓN: ${username} (asiento ${seatIndex}, userId: ${currentSeatAtIndex.userId})`);
                        if (playerIdToUse) {
                            ludoHandlePlayerDeparture(roomId, playerIdToUse, io, false, true); // true = isInactivityTimeout
                        } else {
                            // Si no hay playerId, eliminar directamente el asiento
                            console.log(`[${roomId}] ⚠️ Jugador ${username} está desconectado sin socket. Eliminando asiento directamente.`);
                            currentRoom.seats[seatIndex] = null;
                            // Pasar el turno si era su turno
                            if (currentRoom.gameState && currentRoom.gameState.turn && currentRoom.gameState.turn.playerIndex === seatIndex) {
                                ludoPassTurn(currentRoom, io);
                            }
                        }
                        
                        // Limpiar
                        delete ludoInactivityTimeouts[inactivityTimeoutKey];
                        delete ludoDisconnectedPlayers[disconnectKey];
                    }, LUDO_INACTIVITY_TIMEOUT_MS);
                    
                    console.log(`[LUDO DISCONNECT] ⏰ Timeout de inactividad iniciado para ${username} (userId: ${userId}). Si no vuelve en ${LUDO_INACTIVITY_TIMEOUT_MS/1000} segundos, será eliminado.`);
                } else {
                    // Si NO es su turno, esperar a que le toque el turno
                    console.log(`[LUDO DISCONNECT] ${username} se desconectó pero NO es su turno. Se eliminará cuando le toque el turno y no actúe en 2 minutos.`);
                }
                
                // Notificar a todos que el jugador se desconectó (pero aún puede volver)
                io.to(roomId).emit('playerDisconnected', {
                    playerName: leavingPlayerSeat.playerName,
                    message: `${leavingPlayerSeat.playerName} se desconectó. Esperando reconexión...`
                });
            } else {
                // Si está en espera, eliminar inmediatamente
                ludoHandlePlayerDeparture(roomId, socket.id, io);
            }
            // ▲▲▲ FIN: ESPERAR 2 MINUTOS DE INACTIVIDAD ▲▲▲

        } else {
            // Se desconectó del lobby de Ludo sin estar en una sala
            console.log(`[Lobby Disconnect] ${username} se fue del lobby de Ludo.`);
        }

    } else if (roomId && la51Rooms[roomId]) {
        // ESTABA EN UNA SALA DE LA 51
        const la51Room = la51Rooms[roomId];
        const seatIndex = la51Room.seats.findIndex(s => s && s.playerId === socket.id);
        const userId = socket.userId;
        
        if (seatIndex !== -1 && la51Room.state === 'waiting') {
            // ESTABA EN EL LOBBY DE LA 51 (ESPERANDO)
            // Liberar asiento inmediatamente sin reserva de reconexión
            console.log(`[LA 51 DISCONNECT] ${username} se desconectó de la sala ${roomId} (esperando). Asiento liberado inmediatamente.`);
        handlePlayerDeparture(roomId, socket.id, io);
            
        } else if (seatIndex !== -1 && la51Room.state === 'playing') {
            // ▼▼▼ LOGICA SIMPLE COMO LUDO: Si se desconecta durante partida activa, iniciar timeout si es su turno ▼▼▼
            const leavingPlayerSeat = la51Room.seats[seatIndex];
            
            console.log(`[DEBUG DISCONNECT] 🔍 LA 51 PARTIDA ACTIVA - seatIndex: ${seatIndex}, leavingPlayerSeat: ${!!leavingPlayerSeat}, active: ${leavingPlayerSeat?.active}, status: ${leavingPlayerSeat?.status}`);
            
            if (leavingPlayerSeat && leavingPlayerSeat.active !== false && leavingPlayerSeat.status !== 'waiting') {
                console.log(`[LA 51 DISCONNECT] ${username} se desconectó durante partida activa. Esperando 2 minutos de inactividad cuando le toque el turno.`);
                
                // Verificar si es su turno actualmente
                const isCurrentTurn = la51Room.currentPlayerId === socket.id;
                console.log(`[DEBUG DISCONNECT] 🔍 Verificando turno - currentPlayerId: ${la51Room.currentPlayerId}, socket.id: ${socket.id}, isCurrentTurn: ${isCurrentTurn}`);
                
                // Verificar si el jugador ya fue eliminado
                const globalPenaltyKey = `${roomId}_${userId}`;
                const alreadyEliminated = (la51Room.penaltyApplied && la51Room.penaltyApplied[userId]);
                
                if (alreadyEliminated) {
                    console.log(`[LA 51 DISCONNECT] ${username} ya fue eliminado. NO se inicia timeout.`);
                    return;
                }
                
                if (isCurrentTurn) {
                    // Si es su turno, verificar si ya hay un timeout activo
                    const inactivityTimeoutKey = `${roomId}_${userId}`;
                    const hasActiveTimeout = la51InactivityTimeouts[inactivityTimeoutKey];
                    
                    if (hasActiveTimeout) {
                        console.log(`[LA 51 DISCONNECT] ${username} se desconectó durante su turno, pero ya hay un timeout activo. NO se inicia nuevo timeout.`);
                        return;
                    }
                    
                    // Cancelar TODOS los timeouts posibles antes de iniciar uno nuevo
                    if (la51InactivityTimeouts[inactivityTimeoutKey]) {
                        clearTimeout(la51InactivityTimeouts[inactivityTimeoutKey]);
                        delete la51InactivityTimeouts[inactivityTimeoutKey];
                    }
                    const timeoutKeyByPlayerId = `${roomId}_${socket.id}`;
                    if (la51InactivityTimeouts[timeoutKeyByPlayerId]) {
                        clearTimeout(la51InactivityTimeouts[timeoutKeyByPlayerId]);
                        delete la51InactivityTimeouts[timeoutKeyByPlayerId];
                    }
                    Object.keys(la51InactivityTimeouts).forEach(key => {
                        if (key.startsWith(`${roomId}_`) && (key.includes(userId) || key.includes(socket.id))) {
                            clearTimeout(la51InactivityTimeouts[key]);
                            delete la51InactivityTimeouts[key];
                        }
                    });
                    
                    // Iniciar timeout de inactividad (SIEMPRE 2 minutos completos)
                    la51InactivityTimeouts[inactivityTimeoutKey] = setTimeout(() => {
                        console.log(`[LA 51 DISCONNECT TIMEOUT] ⏰ Han pasado 2 minutos desde que ${username} se desconectó. Eliminando por abandono.`);
                        
                        const currentRoom = la51Rooms[roomId];
                        if (!currentRoom) {
                            delete la51InactivityTimeouts[inactivityTimeoutKey];
                            return;
                        }
                        
                        // Verificar que el turno todavía es de este jugador
                        if (currentRoom.currentPlayerId !== socket.id) {
                            const currentSeat = currentRoom.seats.find(s => s && s.userId === userId);
                            if (!currentSeat || currentRoom.currentPlayerId !== currentSeat.playerId) {
                                console.log(`[LA 51 DISCONNECT TIMEOUT] El turno ya cambió. No se elimina.`);
                                delete la51InactivityTimeouts[inactivityTimeoutKey];
                                return;
                            }
                        }
                        
                        // Verificar que el jugador todavía está en la sala
                        const currentSeat = currentRoom.seats.find(s => s && s.userId === userId);
                        if (!currentSeat) {
                            console.log(`[LA 51 DISCONNECT TIMEOUT] El asiento ya está vacío. No se elimina.`);
                            delete la51InactivityTimeouts[inactivityTimeoutKey];
                            return;
                        }
                        
                        // Verificar que es el mismo jugador
                        if (!currentSeat.userId || currentSeat.userId !== userId) {
                            console.log(`[LA 51 DISCONNECT TIMEOUT] El jugador ya no es el mismo. No se elimina.`);
                            delete la51InactivityTimeouts[inactivityTimeoutKey];
                            return;
                        }
                        
                        // Registrar penalización antes de eliminar
                        if (!currentRoom.penaltyApplied) {
                            currentRoom.penaltyApplied = {};
                        }
                        currentRoom.penaltyApplied[userId] = true;
                        
                        // Eliminar al jugador
                        let playerIdToUse = currentSeat.playerId;
                        if (!playerIdToUse) {
                            for (const [socketId, socket] of io.sockets.sockets.entries()) {
                                const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                                if (socketUserId === userId) {
                                    playerIdToUse = socketId;
                                    break;
                                }
                            }
                        }
                        
                        if (playerIdToUse) {
                            handlePlayerDeparture(roomId, playerIdToUse, io, true); // true = isInactivityTimeout
                        } else {
                            // Si no hay playerId, eliminar directamente el asiento
                            const seatIndexToRemove = currentRoom.seats.findIndex(s => s && s.userId === userId);
                            if (seatIndexToRemove !== -1) {
                                currentRoom.seats[seatIndexToRemove] = null;
                                // Pasar el turno si era su turno
                                if (currentRoom.currentPlayerId === currentSeat.playerId) {
                                    advanceTurnAfterAction(currentRoom, currentSeat.playerId, null, io);
                                }
                            }
                        }
                        
                        delete la51InactivityTimeouts[inactivityTimeoutKey];
                    }, LA51_INACTIVITY_TIMEOUT_MS);
                    
                    console.log(`[LA 51 DISCONNECT] ⏰ Timeout de inactividad iniciado para ${username} (userId: ${userId}). Si no vuelve en ${LA51_INACTIVITY_TIMEOUT_MS/1000} segundos, será eliminado.`);
                } else {
                    console.log(`[LA 51 DISCONNECT] ${username} se desconectó pero NO es su turno. Se eliminará cuando le toque el turno y no actúe en 2 minutos.`);
                }
            } else {
                // Si está en espera, eliminar inmediatamente
                console.log(`[DEBUG DISCONNECT] ⚠️⚠️⚠️ LLAMANDO handlePlayerDeparture DESDE DISCONNECT (esperando) - Usuario: ${username}, socket.id: ${socket.id}, roomId: ${roomId}`);
                try {
                    const stackTrace = new Error().stack;
                    if (stackTrace) {
                        console.log(`[DEBUG DISCONNECT] ⚠️⚠️⚠️ Stack trace:\n${stackTrace}`);
                    }
                } catch (err) {
                    console.log(`[DEBUG DISCONNECT] ⚠️⚠️⚠️ Stack trace no disponible`);
                }
                handlePlayerDeparture(roomId, socket.id, io);
            }
            // ▲▲▲ FIN: LOGICA SIMPLE COMO LUDO ▲▲▲
        } else {
            // Se desconectó del lobby de La 51 sin estar en una sala
            console.log(`[Lobby Disconnect] ${username} se fue del lobby de La 51.`);
        }
    
    } else {
        // Se desconectó del LOBBY PRINCIPAL (sin estar en una sala)
        console.log(`[LOBBY DISCONNECT] ${username} se fue del lobby.`);
    }
  });
  // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

  socket.on('requestRematch', (data) => {
    const { roomId } = data;
    const room = la51Rooms[roomId];
    if (!room) return;

    // ▼▼▼ VERIFICAR SI EL JUEGO YA COMENZÓ ▼▼▼
    if (room.state === 'playing') {
        console.log(`[${roomId}] ⚠️ Jugador ${socket.id} intenta confirmar revancha pero el juego ya comenzó.`);
        socket.emit('rematchGameAlreadyStarted', {
            message: 'La revancha ya comenzó. No puedes confirmar ahora. Serás redirigido al lobby.',
            redirectToLobby: true
        });
        return;
    }
    // ▲▲▲ FIN DE VERIFICACIÓN ▲▲▲

    const playerSeat = room.seats.find(s => s && s.playerId === socket.id);
    if (!playerSeat || !playerSeat.userId) return;

    const playerInfo = users[playerSeat.userId];
    if (!playerInfo) return;

    // 1. El servidor calcula el requisito real.
    const requirementInRoomCurrency = (room.settings.bet || 0) + (room.settings.penalty || 0);
    const requiredInPlayerCurrency = convertCurrency(requirementInRoomCurrency, room.settings.betCurrency, playerInfo.currency, exchangeRates);

    // 2. El servidor valida contra sus propios datos.
    if (playerInfo.credits >= requiredInPlayerCurrency) {
        // SI HAY FONDOS: Procede con la lógica de revancha.
        room.rematchRequests.add(socket.id);

        const readyPlayerIds = new Set();
        room.rematchRequests.forEach(id => readyPlayerIds.add(id));
        room.seats.forEach(seat => {
            if (seat && seat.status === 'waiting') {
                readyPlayerIds.add(seat.playerId);
            }
        });

        const playersReadyNames = Array.from(readyPlayerIds).map(id => {
            const seat = room.seats.find(s => s && s.playerId === id);
            return seat ? seat.playerName : null;
        }).filter(Boolean);

        const totalPlayersReady = readyPlayerIds.size;

        io.to(roomId).emit('rematchUpdate', {
            playersReady: playersReadyNames,
            canStart: totalPlayersReady >= 2,
            hostId: room.hostId
        });
    } else {
        // SI NO HAY FONDOS: El servidor fuerza la salida del jugador.
        console.log(`[Servidor] Jugador ${socket.id} sin créditos para revancha. Se libera el asiento.`);
        socket.emit('rematchFailed', { reason: 'No tienes créditos suficientes para la siguiente partida.' });

        // Usamos la función existente para gestionar la salida y liberar el asiento.
        handlePlayerDeparture(roomId, socket.id, io);
    }
  });

  socket.on('startRematch', (roomId) => {
    const room = la51Rooms[roomId];
    if (!room || socket.id !== room.hostId) return;

    // LÓGICA DE CONTEO CORRECTA (copiada de la sección 'rematchUpdate')
    const readyPlayerIds = new Set();
    room.rematchRequests.forEach(id => readyPlayerIds.add(id));
    room.seats.forEach(seat => {
        if (seat && seat.status === 'waiting') {
            readyPlayerIds.add(seat.playerId);
        }
    });
    const totalPlayersReady = readyPlayerIds.size;

    // AHORA LA CONDICIÓN ES CORRECTA Y CONSISTENTE
    if (totalPlayersReady >= 2) {
        
        console.log(`Iniciando revancha en ${roomId}. Realizando reseteo total...`);

        // 1. IDENTIFICAR JUGADORES PARA LA NUEVA PARTIDA
        const nextGameParticipants = [];
        const playersNotConfirmed = []; // Jugadores que no confirmaron a tiempo
        
        room.seats.forEach(seat => {
            if (seat) {
                if (room.rematchRequests.has(seat.playerId) || seat.status === 'waiting') {
                    // Jugador confirmó, lo incluimos en la nueva partida
                    nextGameParticipants.push({
                        playerId: seat.playerId,
                        playerName: seat.playerName,
                        avatar: seat.avatar,
                        active: true,
                        doneFirstMeld: false,
                        userId: seat.userId
                    });
                } else {
                    // Jugador NO confirmó a tiempo, lo marcamos para liberar su asiento
                    playersNotConfirmed.push(seat);
                }
            }
        });
        
        // ▼▼▼ LIBERAR ASIENTOS DE JUGADORES QUE NO CONFIRMARON A TIEMPO ▼▼▼
        // Notificar a estos jugadores que la partida ya comenzó y deben volver al lobby
        playersNotConfirmed.forEach(seat => {
            console.log(`[${roomId}] Jugador ${seat.playerName} no confirmó a tiempo. Liberando asiento y notificando.`);
            // Liberar el asiento
            const seatIndex = room.seats.findIndex(s => s && s.playerId === seat.playerId);
            if (seatIndex !== -1) {
                room.seats[seatIndex] = null;
            }
            // Notificar al jugador que debe volver al lobby
            io.to(seat.playerId).emit('rematchGameStartedWithoutYou', {
                message: 'La revancha ya comenzó sin tu confirmación. Serás redirigido al lobby.',
                redirectToLobby: true
            });
            // Actualizar estado del usuario
            if (connectedUsers[seat.playerId]) {
                const currentLobby = connectedUsers[seat.playerId].currentLobby;
                connectedUsers[seat.playerId].status = currentLobby ? `En el lobby de ${currentLobby}` : 'En el Lobby';
            }
            // Limpiar referencia de la sala en el socket
            const playerSocket = io.sockets.sockets.get(seat.playerId);
            if (playerSocket) {
                delete playerSocket.currentRoomId;
                playerSocket.leave(roomId);
            }
        });
        // Actualizar lista de usuarios después de liberar asientos
        if (playersNotConfirmed.length > 0) {
            broadcastUserListUpdate(io);
        }
        // ▲▲▲ FIN DE LIBERAR ASIENTOS ▲▲▲

        // ▼▼▼ AÑADE ESTE NUEVO BLOQUE DE CÓDIGO AQUÍ ▼▼▼
        // 2. ✨ LIMPIEZA DEFINITIVA DE LA LISTA DE ESPECTADORES ✨
        // Eliminamos a cualquiera que vaya a jugar de la lista de espectadores.
        if (room.spectators && room.spectators.length > 0) {
            const participantIds = new Set(nextGameParticipants.map(p => p.playerId));
            room.spectators = room.spectators.filter(spec => !participantIds.has(spec.id));
            console.log(`[Rematch Cleanup] Espectadores purgados. Quedan: ${room.spectators.length}`);
        }
        // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

        // 3. ✨ RESETEO TOTAL DEL ESTADO DE LA SALA ✨
        const newSeats = [null, null, null, null];
        nextGameParticipants.forEach((player, i) => {
            if (i < 4) newSeats[i] = player;
        });

        room.state = 'playing';
        if (!room.chatHistory) room.chatHistory = [];
        room.chatHistory.push({ sender: 'Sistema', message: 'Ha comenzado la revancha.' });
        room.seats = newSeats;
        room.initialSeats = JSON.parse(JSON.stringify(room.seats.filter(s => s !== null)));
        room.melds = [];
        room.deck = [];
        room.discardPile = [];
        room.playerHands = {};
        room.turnMelds = [];
        room.turnPoints = 0;
        room.hasDrawn = false;
        room.drewFromDiscard = null;
        room.firstMeldCompletedByAnyone = false;
        room.rematchRequests.clear();

        // 3. REPARTIR CARTAS Y CONFIGURAR EL JUEGO

        // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AQUÍ ▼▼▼
        // LIMPIEZA DEFINITIVA DE ESPECTADORES:
        // Antes de continuar, validamos que todos en la lista de espectadores sigan conectados.
        if (room.spectators) {
            const connectedSocketsInRoom = io.sockets.adapter.rooms.get(roomId);
            if (connectedSocketsInRoom) {
                room.spectators = room.spectators.filter(spectator => 
                    connectedSocketsInRoom.has(spectator.id)
                );
                console.log(`Lista de espectadores purgada. Quedan ${room.spectators.length} espectadores válidos.`);
            } else {
                // Si por alguna razón la sala no existe en el adapter, la vaciamos.
                room.spectators = [];
            }
        }
        // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

        // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO AQUÍ ▼▼▼
        // 5. REINICIAR Y CALCULAR EL BOTE PARA LA REVANCHA
        room.pot = 0; // Se resetea el bote
        const seatedPlayersForRematch = room.seats.filter(s => s !== null);

        seatedPlayersForRematch.forEach(async (seat) => {
            if (seat) {
                const playerInfo = users[seat.userId]; // Usamos el objeto 'users'
                if (playerInfo) {
                    const roomBet = room.settings.bet;
                    const roomCurrency = room.settings.betCurrency;

                    // 1. Convertir la apuesta a la moneda del jugador para descontarla
                    const betInPlayerCurrency = convertCurrency(roomBet, roomCurrency, playerInfo.currency, exchangeRates);

                    // 2. Descontar el valor convertido de los créditos del jugador
                    playerInfo.credits -= betInPlayerCurrency;

                    // ▼▼▼ LÍNEA AÑADIDA: Guardar en la Base de Datos ▼▼▼
                    await updateUserCredits(seat.userId, playerInfo.credits, playerInfo.currency);
                    // ▲▲▲ FIN DE LA LÍNEA AÑADIDA ▲▲▲

                    // 3. El bote siempre suma el valor original en la moneda de la mesa
                    room.pot += roomBet;

                    // 4. Notificar al jugador su estado completo (créditos y moneda)
                    io.to(seat.playerId).emit('userStateUpdated', playerInfo);
                }
            }
        });

        console.log(`[Rematch] Partida iniciada. Bote inicial: ${room.pot}.`);
        // Se notifica a todos en la sala del nuevo valor del bote
        io.to(roomId).emit('potUpdated', { newPotValue: room.pot, isPenalty: false });
        // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

        const newDeck = buildDeck();
        shuffle(newDeck);
        const seatedPlayers = room.seats.filter(s => s !== null);

        if (room.lastWinnerId) {
            const winnerIndex = seatedPlayers.findIndex(p => p.playerId === room.lastWinnerId);
            if (winnerIndex > 0) {
                const winner = seatedPlayers.splice(winnerIndex, 1)[0];
                seatedPlayers.unshift(winner);
            }
        }
        
        seatedPlayers.forEach(player => {
            if (player) room.playerHands[player.playerId] = newDeck.splice(0, 14);
        });
        
        const startingPlayerId = seatedPlayers[0].playerId;
        room.playerHands[startingPlayerId].push(newDeck.shift());
        room.hasDrawn = true;
        room.discardPile = [newDeck.shift()];
        room.deck = newDeck;
        room.currentPlayerId = startingPlayerId;

        // 4. NOTIFICAR A TODOS LOS CLIENTES
        const playerHandCounts = {};
        seatedPlayers.forEach(player => {
            if (player) playerHandCounts[player.playerId] = room.playerHands[player.playerId].length;
        });

        // ▼▼▼ AÑADE ESTE BLOQUE AQUÍ ▼▼▼
        // Notifica a TODOS en la sala que reseteen su chat y lista de espectadores para la revancha.
        io.to(roomId).emit('resetForNewGame', { 
            spectators: room.spectators || [] // Envía la lista de espectadores actualizada
        });
        // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

        // Encontrar el asiento del jugador que inicia
        const startingPlayerSeat = room.seats.find(s => s && s.playerId === startingPlayerId);

        seatedPlayers.forEach(player => {
            if (player) {
                const isStartingPlayer = player.playerId === startingPlayerId;
                io.to(player.playerId).emit('gameStarted', {
                    hand: room.playerHands[player.playerId],
                    discardPile: room.discardPile,
                    seats: room.seats,
                    currentPlayerId: room.currentPlayerId,
                    playerHandCounts: playerHandCounts,
                    melds: room.melds,
                    isFirstTurn: isStartingPlayer && !startingPlayerSeat?.isBot // Indicar si es el primer turno
                });
            }
        });
        
        // ▼▼▼ MENSAJE PARA EL JUGADOR QUE INICIA LA REVANCHA ▼▼▼
        // Enviar mensaje informativo al jugador que inicia (si no es bot)
        // IMPORTANTE: Enviar con un delay para asegurar que el listener esté registrado
        if (startingPlayerSeat && !startingPlayerSeat.isBot) {
            console.log(`[startRematch] Enviando firstTurnInfo a ${startingPlayerSeat.playerName} (${startingPlayerId})`);
            setTimeout(() => {
                io.to(startingPlayerId).emit('firstTurnInfo', {
                    message: '¡Es tu primer turno! Empiezas con 15 cartas. Debes descartar una carta para comenzar el juego.',
                    playerName: startingPlayerSeat.playerName
                });
                console.log(`[startRematch] ✅ firstTurnInfo enviado a ${startingPlayerSeat.playerName}`);
            }, 1500); // Delay de 1500ms para asegurar que el listener esté listo
        }
        // ▲▲▲ FIN DEL MENSAJE ▲▲▲
        
        // Iniciar timeout de inactividad para el jugador que inicia (si no es bot) - igual que en Ludo
        if (startingPlayerSeat && !startingPlayerSeat.isBot && startingPlayerSeat.userId) {
            const newTimeoutKey = `${roomId}_${startingPlayerSeat.userId}`;
            const alreadyPenalized = (room.penaltyApplied && room.penaltyApplied[startingPlayerSeat.userId]);
            if (!alreadyPenalized) {
                if (la51InactivityTimeouts[newTimeoutKey]) {
                    clearTimeout(la51InactivityTimeouts[newTimeoutKey]);
                    delete la51InactivityTimeouts[newTimeoutKey];
                }
                const newTimeoutKeyByPlayerId = `${roomId}_${startingPlayerId}`;
                if (la51InactivityTimeouts[newTimeoutKeyByPlayerId]) {
                    clearTimeout(la51InactivityTimeouts[newTimeoutKeyByPlayerId]);
                    delete la51InactivityTimeouts[newTimeoutKeyByPlayerId];
                }
                Object.keys(la51InactivityTimeouts).forEach(key => {
                    if (key.startsWith(`${roomId}_`) && (key.includes(startingPlayerSeat.userId) || key.includes(startingPlayerId))) {
                        clearTimeout(la51InactivityTimeouts[key]);
                        delete la51InactivityTimeouts[key];
                    }
                });
                la51InactivityTimeouts[newTimeoutKey] = setTimeout(() => {
                    const currentRoom = la51Rooms[roomId];
                    if (!currentRoom || currentRoom.currentPlayerId !== startingPlayerId) {
                        const currentSeat = currentRoom.seats.find(s => s && s.userId === startingPlayerSeat.userId);
                        if (!currentSeat || currentRoom.currentPlayerId !== currentSeat.playerId) {
                            delete la51InactivityTimeouts[newTimeoutKey];
                            return;
                        }
                    }
                    const currentSeat = currentRoom.seats.find(s => s && s.userId === startingPlayerSeat.userId);
                    if (!currentSeat || currentSeat.userId !== startingPlayerSeat.userId) {
                        delete la51InactivityTimeouts[newTimeoutKey];
                        return;
                    }
                    if (!currentRoom.penaltyApplied) currentRoom.penaltyApplied = {};
                    currentRoom.penaltyApplied[currentSeat.userId] = true;
                    let playerIdToUse = currentSeat.playerId;
                    if (!playerIdToUse && currentSeat.userId) {
                        for (const [socketId, socket] of io.sockets.sockets.entries()) {
                            const socketUserId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
                            if (socketUserId === currentSeat.userId) {
                                playerIdToUse = socketId;
                                break;
                            }
                        }
                    }
                    if (playerIdToUse) {
                        handlePlayerDeparture(roomId, playerIdToUse, io, true);
                    }
                    delete la51InactivityTimeouts[newTimeoutKey];
                }, LA51_INACTIVITY_TIMEOUT_MS);
            }
        } else if (startingPlayerSeat && startingPlayerSeat.isBot) {
            setTimeout(() => botPlay(room, startingPlayerId, io), 1000);
        }

        broadcastRoomListUpdate(io);

    }
    // ▲▲▲ FIN DEL BLOQUE DE REEMPLAZO ▲▲▲
  });

  // ▼▼▼ REEMPLAZA TU LISTENER socket.on('leaveGame',...) ENTERO CON ESTE ▼▼▼
  socket.on('leaveGame', (data) => {
    const { roomId } = data;
    const username = connectedUsers[socket.id]?.username || socket.userId?.replace(/^user_/, '') || socket.id;
    
    console.log(`[DEBUG leaveGame] 🔍 INICIO leaveGame - Usuario: ${username}, socket.id: ${socket.id}, roomId: ${roomId}`);
    try {
        const stackTrace = new Error().stack;
        if (stackTrace) {
            console.log(`[DEBUG leaveGame] 🔍 Stack trace:\n${stackTrace}`);
        }
    } catch (err) {
        console.log(`[DEBUG leaveGame] 🔍 Stack trace no disponible`);
    }

    // ▼▼▼ CRÍTICO: Detectar si es una sala de Ludo o La 51 ▼▼▼
    const isLudoRoom = roomId && ludoRooms[roomId];
    const isLa51Room = roomId && la51Rooms[roomId];
    
    console.log(`[DEBUG leaveGame] 🔍 isLudoRoom: ${isLudoRoom}, isLa51Room: ${isLa51Room}`);
    
    // ▼▼▼ CRÍTICO: Si la sala no existe, limpiar estado y salir ▼▼▼
    if (!isLudoRoom && !isLa51Room && roomId) {
        const userId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
        if (userId) {
            const globalPenaltyKey = `${roomId}_${userId}`;
            const alreadyPenalized = ludoGlobalPenaltyApplied[globalPenaltyKey];
            
            if (alreadyPenalized) {
                console.log(`[leaveGame] ${userId} intentó salir de sala ${roomId} que no existe, pero ya fue penalizado anteriormente. NO se procesa abandono.`);
            }
        }
        console.warn(`[leaveGame] Sala ${roomId} no encontrada en ludoRooms ni la51Rooms. Limpiando estado del socket.`);
        
        // Limpiar estado del socket completamente
        if (roomId) {
            socket.leave(roomId);
        }
            delete socket.currentRoomId;
        
        // Actualizar estado del usuario
        if (connectedUsers[socket.id]) {
            const currentLobby = connectedUsers[socket.id].currentLobby;
            if (currentLobby) {
                connectedUsers[socket.id].status = `En el lobby de ${currentLobby}`;
            } else {
                connectedUsers[socket.id].status = 'En el Lobby';
            }
            broadcastUserListUpdate(io);
        }
        
        return; // Salir sin procesar abandono si la sala no existe
    }
    // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
    
    // 1. (ORDEN CORREGIDO) Primero, ejecuta toda la lógica de estado del juego.
    // Esto asegura que el asiento se libere, se apliquen multas y el juego avance
    // antes de limpiar el estado del socket.
    if (isLudoRoom) {
        // Es una sala de Ludo - usar ludoHandlePlayerDeparture
        // CRÍTICO: Pasar isVoluntaryAbandonment=true para procesar INMEDIATAMENTE sin esperar timeouts
        ludoHandlePlayerDeparture(roomId, socket.id, io, true);
    } else if (isLa51Room) {
        // Es una sala de La 51 - usar handlePlayerDeparture
        // ▼▼▼ CRÍTICO: Verificar si el jugador está en una partida activa antes de eliminar ▼▼▼
        // Si está en una partida activa, NO eliminar - el timeout se encargará de eso
        const la51Room = la51Rooms[roomId];
        if (la51Room && la51Room.state === 'playing') {
            const seatIndex = la51Room.seats.findIndex(s => s && s.playerId === socket.id);
            if (seatIndex !== -1) {
                const playerSeat = la51Room.seats[seatIndex];
                if (playerSeat && playerSeat.active !== false && playerSeat.status !== 'waiting') {
                    // Está en una partida activa - NO eliminar, el timeout se encargará
                    console.log(`[leaveGame] ⚠️ Jugador ${socket.id} intentó salir de partida activa de La 51. NO se elimina - el timeout se encargará.`);
                    return; // NO procesar leaveGame si está en partida activa
                }
            }
        }
        // ▲▲▲ FIN VERIFICACIÓN DE PARTIDA ACTIVA ▲▲▲
        handlePlayerDeparture(roomId, socket.id, io);
    }

    // 2. (ORDEN CORREGIDO) AHORA, con la lógica del juego ya resuelta,
    // limpiamos el estado del socket de forma segura.
    if (roomId) {
        console.log(`[DEBUG leaveGame] ⚠️⚠️⚠️ HACIENDO socket.leave DESDE leaveGame - Usuario: ${username}, socket.id: ${socket.id}, roomId: ${roomId}`);
        try {
            const stackTrace = new Error().stack;
            if (stackTrace) {
                console.log(`[DEBUG leaveGame] ⚠️⚠️⚠️ Stack trace:\n${stackTrace}`);
            }
        } catch (err) {
            console.log(`[DEBUG leaveGame] ⚠️⚠️⚠️ Stack trace no disponible`);
        }
        socket.leave(roomId);
        console.log(`[leaveGame] Socket ${socket.id} ha salido de la sala Socket.IO: ${roomId}`);
    }
    
    // ▼▼▼ LIMPIEZA AGRESIVA: Forzar salida de todas las salas relacionadas con práctica ▼▼▼
    if (socket.rooms) {
        for (const room of Array.from(socket.rooms)) {
            if (room !== socket.id && (room.includes('practice') || room === roomId)) {
                socket.leave(room);
                console.log(`[leaveGame] 🧹 Socket ${socket.id} salió de sala residual: ${room}`);
            }
        }
    }
    // ▲▲▲ FIN DE LIMPIEZA AGRESIVA ▲▲▲
    
    // Limpiar currentRoomId
    delete socket.currentRoomId;
    console.log(`[leaveGame] ✅ socket.currentRoomId eliminado para ${socket.id}`);

    // 3. Finalmente, actualizamos el estado del usuario basándose en su lobby actual
    if (connectedUsers[socket.id]) {
        const currentLobby = connectedUsers[socket.id].currentLobby;
        if (currentLobby) {
            connectedUsers[socket.id].status = `En el lobby de ${currentLobby}`;
        } else {
            connectedUsers[socket.id].status = 'En el Lobby';
        }
        broadcastUserListUpdate(io);
    }
    
    console.log(`[leaveGame] ✅ Estado final del socket ${socket.id}:`, {
        currentRoomId: socket.currentRoomId,
        userId: socket.userId,
        rooms: Array.from(socket.rooms || [])
    });
  });
  // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

  // ▼▼▼ AÑADE ESTE LISTENER COMPLETO AL FINAL ▼▼▼
  socket.on('requestPracticeRematch', (data) => {
    const oldRoomId = data.roomId;
    const oldRoom = la51Rooms[oldRoomId]; // Usar la51Rooms en lugar de rooms

    const playerSeat = oldRoom ? oldRoom.seats.find(s => s && s.playerId === socket.id) : null;
    // Obtenemos nombre Y avatar del asiento anterior
    const username = playerSeat ? playerSeat.playerName : 'Jugador';
    const avatar = playerSeat ? playerSeat.avatar : ''; // <-- Nueva línea

    if (oldRoom) {
        delete la51Rooms[oldRoomId]; // Usar la51Rooms en lugar de rooms
        console.log(`[Práctica] Sala anterior ${oldRoomId} eliminada.`);
    }

    console.log(`[Práctica] Creando nueva partida para ${username}.`);
    // Pasamos ambos datos a la función
    createAndStartPracticeGame(socket, username, avatar, io); // <-- Línea modificada
    // ▲▲▲ FIN DEL CÓDIGO DE REEMPLAZO ▲▲▲
  });
  // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

  // ▼▼▼ HANDLERS DE SOCKET DE LUDO (copiados de ludoserver.js, cambiando rooms por ludoRooms) ▼▼▼
    socket.on('createLudoRoom', (settings) => {
      // ▼▼▼ LÓGICA DE `createLudoRoom` ACTUALIZADA ▼▼▼
      const username = connectedUsers[socket.id]?.username;

      if (!username) {
          console.error('❌ Usuario no autenticado intentando crear sala:', socket.id);
          return socket.emit('roomCreationFailed', { message: 'Debes iniciar sesión.' });
      }

      // ▼▼▼ CORRECCIÓN CRÍTICA: Usar userId (user_username) para encontrar al usuario ▼▼▼
      const userId = 'user_' + username.toLowerCase(); // Debe coincidir con cómo se guarda en userLoggedIn
      const userInfo = users[userId];
      if (!userInfo) {
          console.error(`❌ No se encontró userInfo para ${username} (buscando como ${userId}). Usuarios disponibles:`, Object.keys(users));
          return socket.emit('roomCreationFailed', { message: 'Información de usuario no disponible. Por favor, recarga la página.' });
      }

      // ▼▼▼ CORRECCIÓN: Solo validar apuesta ▼▼▼
      const bet = parseFloat(settings.bet) || 0;
      const totalCostInUserCurrency = convertCurrency(bet, settings.betCurrency, userInfo.currency, exchangeRates);

      if (userInfo.credits < totalCostInUserCurrency) {
          console.log(`Fallo de créditos para ${username}: Tiene ${userInfo.credits} ${userInfo.currency}, necesita ${totalCostInUserCurrency} ${userInfo.currency}`);
          return socket.emit('roomCreationFailed', { 
              message: `No tienes suficientes créditos. Necesitas ${totalCostInUserCurrency.toFixed(2)} ${userInfo.currency}.` 
          });
      }
      // ▲▲▲ FIN DE LAS CORRECCIONES ▲▲▲

      const roomId = ludoGenerateRoomId();

      // --- INICIO DE LÓGICA DE ASIGNACIÓN DE ASIENTOS ---
      const hostColor = settings.chosenColor || 'yellow';

      // 1. El colorMap es ESTÁTICO: define el color de cada asiento físico.
      // Asiento 0 = yellow (Abajo-Derecha)
      // Asiento 1 = green (Abajo-Izquierda)
      // Asiento 2 = red (Arriba-Izquierda)
      // Asiento 3 = blue (Arriba-Derecha)
      const colorMap = ['yellow', 'green', 'red', 'blue'];

      // 2. El host elige su color, lo que determina su asiento (seatIndex).
      const hostSeatIndex = colorMap.indexOf(hostColor);
      if (hostSeatIndex === -1) {
          console.error(`Error: Color de host inválido "${hostColor}"`);
          return socket.emit('roomCreationFailed', { message: 'Color de host inválido.' });
      }

      console.log(`[Sala ${roomId}] Anfitrión eligió ${hostColor} (Asiento ${hostSeatIndex}).`);
      // --- FIN DE LÓGICA DE ASIGNACIÓN ---

      // ▼▼▼ BLOQUE REEMPLAZADO (INICIALIZACIÓN DEL JUEGO) ▼▼▼
      // --- Configuración específica según el tipo de juego ---
      const gameType = settings.gameType === 'parchis' ? 'parchis' : 'ludo';
      const pieceCount = (gameType === 'parchis') ? 4 : (settings.pieceCount || 4);
      const autoExitSetting = (gameType === 'parchis') ? 'double' : (settings.autoExit || 'double');
      const parchisModeSetting = settings.parchisMode || '4-individual';
    
      // ▼▼▼ FUNCIÓN PARA OBTENER POSICIÓN DE SALIDA ▼▼▼
      function getStartPosition(color) {
          const startPositions = { yellow: 5, blue: 22, red: 39, green: 56 };
          return startPositions[color];
      }
      // ▲▲▲ FIN FUNCIÓN ▲▲▲
    
      // 1. Inicializar las fichas para los 4 colores
      let initialPieces = {};
      const allColorsForPieces = ['yellow', 'green', 'red', 'blue'];
      allColorsForPieces.forEach(color => {
          initialPieces[color] = [];
          for (let i = 0; i < pieceCount; i++) {
              let pieceState = 'base';
              let piecePosition = -1;
            
              // Lógica de salida automática SOLO aplica a Ludo con autoExit 'auto'
              if (gameType === 'ludo' && autoExitSetting === 'auto') {
                  pieceState = 'active';
                  piecePosition = getStartPosition(color);
              }
            
              initialPieces[color].push({
                  id: `${color}-${i + 1}`, // ej: yellow-1
                  color: color,
                  state: pieceState, // 'base' o 'active' según autoExit
                  position: piecePosition,  // -1 = base, o posición de salida
              });
          }
      });

      const newRoom = {
        roomId: roomId,
        hostId: socket.id,
        createdAt: Date.now(), // Timestamp de creación para evitar eliminación prematura
          settings: {
              ...settings,
              userId: settings.userId || userId, // Asegurar que userId esté en settings
              roomName: settings.username,
              colorMap: colorMap,
              pieceCount: pieceCount,
              autoExit: autoExitSetting,
              gameType: gameType,
              parchisMode: parchisModeSetting,
              hostSeatIndex: hostSeatIndex
          },
        state: 'waiting',
          seats: [null, null, null, null],
          reconnectSeats: {},
          spectators: [],
          isPractice: false,
        
          // --- INICIO DE LA LÓGICA DEL JUEGO ---
          gameState: {
              pot: 0, // Bote del juego
              turn: {
                  playerIndex: -1, // -1 = no empezado
                  canRoll: true,
                  dice: [0, 0],
                  moves: [], // Movimientos pendientes
                  doublesCount: 0,
                  isMoving: false,
                  prizeMoves: 0,
                  lastMovedPieceId: null
              },
              pieces: initialPieces,
              board: {
                  // Puntos de salida
                  start: { yellow: 5, blue: 22, red: 39, green: 56 },
                
                  // Celdas seguras (según tus reglas)
                  safe: [12, 17, 29, 34, 46, 51, 63, 68],
                
                  // Celdas seguras de salida (con regla especial)
                  startSafe: [5, 22, 39, 56],

                  // Celdas de entrada a la meta
                  entry: { yellow: 68, blue: 17, red: 34, green: 51 },

                  // Celdas de la zona de meta (recorrido)
                  home_stretch: {
                      yellow: [69, 70, 71, 72, 73, 74, 75], // 7 celdas
                      blue:   [76, 77, 78, 79, 80, 81, 82], // 7 celdas
                      red:    [83, 84, 85, 86, 87, 88, 89], // 7 celdas
                      green:  [90, 91, 92, 93, 94, 95, 96]  // 7 celdas
                  },
                
                  // Celda final (meta)
                  goal: { yellow: 110, blue: 107, red: 99, green: 102 }
              }
          }
          // --- FIN DE LA LÓGICA DEL JUEGO ---
      };
      // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

      // 3. Asignar al anfitrión a su asiento elegido
      // Obtener avatar con fallback mejorado
      let hostAvatar = '';
      if (userInfo && userInfo.avatar_url) {
          hostAvatar = userInfo.avatar_url;
      } else if (userInfo && userInfo.avatar) {
          hostAvatar = userInfo.avatar;
      } else {
          // Avatar por defecto basado en el índice del asiento
          const defaultAvatarIndex = (hostSeatIndex % 10) + 1;
          hostAvatar = `https://i.pravatar.cc/150?img=${defaultAvatarIndex}`;
      }

      newRoom.seats[hostSeatIndex] = {
          playerId: socket.id,
          playerName: username,
          avatar: hostAvatar, // Avatar con fallback mejorado
          userId: settings.userId,
          status: 'waiting',
          color: hostColor // Asignar el color
      };

      ludoRooms[roomId] = newRoom;
      socket.join(roomId);
      socket.currentRoomId = roomId;

      console.log(`✅ Mesa creada: ${roomId} por ${username}`);

      socket.emit('roomCreatedSuccessfully', {
          roomId: roomId,
          roomName: settings.username,
          seats: newRoom.seats,
          settings: newRoom.settings,
          mySeatIndex: hostSeatIndex, // El creador va a su asiento elegido
          gameState: newRoom.gameState // <-- AÑADE ESTA LÍNEA
      });

      // ▼▼▼ INICIO DE LA CORRECCIÓN EXACTA ▼▼▼

      // 1. ACTUALIZA EL ESTADO DEL JUGADOR "A" A "JUGANDO"
      if (connectedUsers[socket.id]) {
          connectedUsers[socket.id].status = 'Jugando';
          // 2. NOTIFICA A TODOS (INCLUYENDO A "B") DE LA NUEVA LISTA DE USUARIOS
          broadcastUserListUpdate(io); 
      }

      // 3. NOTIFICA A TODOS (INCLUYENDO A "B") DE LA NUEVA LISTA DE SALAS DE LUDO
      console.log(`[DEBUG LUDO] Emitiendo lista de salas de Ludo. Total salas: ${Object.keys(ludoRooms).length}`);
      broadcastLudoRoomListUpdate(io);
      console.log(`[DEBUG LUDO] Lista de salas de Ludo emitida. Sala creada: ${roomId}`);

      // ▲▲▲ FIN DE LA CORRECCIÓN EXACTA ▲▲▲
      // ▲▲▲ FIN DE LA ACTUALIZACIÓN DE `createLudoRoom` ▲▲▲
    });

    socket.on('joinLudoRoom', ({ roomId, user }) => {
      // ▼▼▼ LÓGICA DE `joinLudoRoom` ACTUALIZADA ▼▼▼
      const room = ludoRooms[roomId];

      if (!room) {
          // La sala ya no existe (probablemente fue limpiada después de abandono)
          console.log(`[LUDO JOIN ROOM] ${user.username} intentó unirse a sala ${roomId} que ya no existe.`);
          socket.emit('gameEnded', { 
              reason: 'room_not_found', 
              message: 'La sala ya no existe. Puede que hayas sido eliminado por abandono.',
              redirect: true
          });
          return;
      }
      
      const username = user.username;
      // ▼▼▼ CORRECCIÓN CRÍTICA: Usar userId (user_username) para encontrar al usuario ▼▼▼
      const userId = user.userId || ('user_' + username.toLowerCase()); // Debe coincidir con cómo se guarda en userLoggedIn
      
      // Verificar si el jugador fue eliminado por abandono antes de permitir unirse
      if (room.abandonmentFinalized && room.abandonmentFinalized[userId]) {
          console.log(`[LUDO JOIN ROOM BLOCKED] ${username} intentó unirse pero fue eliminado por abandono.`);
          const bet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';
          
          // ▼▼▼ CRÍTICO: Forzar salida del socket de la sala y limpiar estado antes de redirigir ▼▼▼
          if (socket.currentRoomId === roomId) {
              socket.leave(roomId);
              delete socket.currentRoomId;
              console.log(`[${roomId}] Socket ${socket.id} forzado a salir de la sala después de intento de unirse con abandono finalizado`);
          }
          // ▲▲▲ FIN LIMPIEZA DE SOCKET ▲▲▲
          
          socket.emit('gameEnded', { 
              reason: 'abandonment', 
              message: `Has sido eliminado por abandono. Se te ha descontado la apuesta de ${bet} ${roomCurrency}.`,
              redirect: true,
              forceExit: true, // Flag extra para forzar salida
              penalty: bet,
              currency: roomCurrency
          });
          return;
      }

      // --- Bloqueo para Partidas 1 vs 1 ---
      if (room.settings.gameType === 'parchis' && room.settings.parchisMode === '2-individual') {
          const seatedPlayers = room.seats.filter(s => s !== null).length;
          if (seatedPlayers >= 2) {
              console.log(`[${roomId}] Rechazado: Intento de unirse a partida 1 vs 1 llena.`);
              return socket.emit('ludoError', { message: 'Esta partida es 1 vs 1 y ya está llena.' });
          }
      }
      // --- Fin Bloqueo 1 vs 1 ---

      // Permitir unirse a mesas en espera, en juego o en revancha
      if (room.state !== 'waiting' && room.state !== 'playing' && room.state !== 'post-game') {
          return socket.emit('joinRoomFailed', { message: 'La sala no está disponible.' });
      }
      const userInfo = users[userId];
      
      if (!userInfo) {
          console.error(`❌ No se encontró userInfo para ${username} (buscando como ${userId}). Usuarios disponibles:`, Object.keys(users));
          return socket.emit('joinRoomFailed', { message: 'Información de usuario no disponible. Por favor, recarga la página.' });
      }
      // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

      const bet = parseFloat(room.settings.bet) || 0;
      const totalCostInRoomCurrency = bet;
    
      const totalCostInUserCurrency = convertCurrency(totalCostInRoomCurrency, room.settings.betCurrency, userInfo.currency, exchangeRates);

      if (userInfo.credits < totalCostInUserCurrency) {
          return socket.emit('joinRoomFailed', { 
              message: `No tienes suficientes créditos. Necesitas ${totalCostInUserCurrency.toFixed(2)} ${userInfo.currency}.` 
          });
      }

      const existingSeatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
      if (existingSeatIndex !== -1) {
          return socket.emit('joinRoomFailed', { message: 'Ya estás en esta sala.' });
      }

      // ▼▼▼ LÍNEA CORREGIDA ▼▼▼
      const reconnectSeatInfo = (room.reconnectSeats && user.userId) ? room.reconnectSeats[user.userId] : null;
      // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
      if (reconnectSeatInfo && room.seats[reconnectSeatInfo.seatIndex] !== null) {
          ludoClearReconnection(roomId, user.userId);
      }

      const effectiveReconnectSeatInfo = (room.reconnectSeats && user.userId) ? room.reconnectSeats[user.userId] : null;
      
      // ▼▼▼ FIX CRÍTICO: Verificar si el juego ya terminó por abandono antes de permitir reconexión ▼▼▼
      if (effectiveReconnectSeatInfo) {
          // Verificar si el abandono ya fue finalizado (juego terminó)
          if (room.abandonmentFinalized && room.abandonmentFinalized[user.userId]) {
              console.log(`[LUDO RECONNECT BLOCKED] ${username} intentó reconectar pero el juego ya terminó por su abandono. Redirigiendo al lobby.`);
              const username = user.username || userId.replace('user_', '');
              const bet = parseFloat(room.settings.bet) || 0;
              const roomCurrency = room.settings.betCurrency || 'USD';
              
              // ▼▼▼ CRÍTICO: Forzar salida del socket de la sala y limpiar estado antes de redirigir ▼▼▼
              if (socket.currentRoomId === roomId) {
                  socket.leave(roomId);
                  delete socket.currentRoomId;
                  console.log(`[${roomId}] Socket ${socket.id} forzado a salir de la sala después de intento de reconexión con abandono finalizado`);
              }
              // ▲▲▲ FIN LIMPIEZA DE SOCKET ▲▲▲
              
              socket.emit('gameEnded', { 
                  reason: 'abandonment', 
                  message: `Has abandonado la partida. Se te ha descontado la apuesta de ${bet} ${roomCurrency}. El juego terminó.`,
                  redirect: true,
                  forceExit: true, // Flag extra para forzar salida
                  penalty: bet,
                  currency: roomCurrency
              });
              return; // NO permitir reconexión
          }
          
          // Si el juego está en post-game por abandono, verificar si fue por este jugador
          if (room.state === 'post-game' && room.rematchData && room.rematchData.abandonment) {
              // Verificar si este jugador fue el que abandonó
              const wasAbandoner = !room.seats.some(s => s && s.userId === user.userId && s.status === 'playing');
              if (wasAbandoner) {
                  console.log(`[LUDO RECONNECT BLOCKED] ${username} intentó reconectar pero el juego ya terminó por su abandono. Redirigiendo al lobby.`);
                  
                  // ▼▼▼ CRÍTICO: Forzar salida del socket de la sala y limpiar estado antes de redirigir ▼▼▼
                  if (socket.currentRoomId === roomId) {
                      socket.leave(roomId);
                      delete socket.currentRoomId;
                      console.log(`[${roomId}] Socket ${socket.id} forzado a salir de la sala después de intento de reconexión con abandono finalizado`);
                  }
                  // ▲▲▲ FIN LIMPIEZA DE SOCKET ▲▲▲
                  
                  socket.emit('gameEnded', { 
                      reason: 'abandonment', 
                      message: 'El juego terminó porque abandonaste. No puedes reconectar a esta partida.',
                      redirect: true,
                      forceExit: true // Flag extra para forzar salida
                  });
                  return; // NO permitir reconexión
              }
          }
          
          // Cancelar el timeout de abandono si existe
          if (room.abandonmentTimeouts && room.abandonmentTimeouts[user.userId]) {
              clearTimeout(room.abandonmentTimeouts[user.userId]);
              delete room.abandonmentTimeouts[user.userId];
              console.log(`[LUDO RECONNECT] ${username} se reconectó exitosamente. Timeout de abandono cancelado.`);
          }
          
          const timeoutKey = `${roomId}_${user.userId}`;
          if (ludoReconnectTimeouts[timeoutKey]) {
              clearTimeout(ludoReconnectTimeouts[timeoutKey]);
              delete ludoReconnectTimeouts[timeoutKey];
          }
          
          ludoClearReconnection(roomId, user.userId);
          
          // ▼▼▼ LIMPIAR ESTADO DE DESCONEXIÓN: El jugador se reconectó ▼▼▼
          const disconnectKey = `${roomId}_${user.userId}`;
          if (ludoDisconnectedPlayers[disconnectKey]) {
              delete ludoDisconnectedPlayers[disconnectKey];
              console.log(`[${roomId}] ✓ Estado de desconexión limpiado para ${user.userId} (jugador se reconectó)`);
          }
          // Cancelar timeout de inactividad si existe
          const inactivityTimeoutKey = `${roomId}_${socket.id}`;
          if (ludoInactivityTimeouts[inactivityTimeoutKey]) {
              clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKey]);
              delete ludoInactivityTimeouts[inactivityTimeoutKey];
              console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${socket.id} (jugador se reconectó)`);
          }
          // ▲▲▲ FIN LIMPIEZA ESTADO DESCONEXIÓN ▲▲▲
          
          // Notificar a todos que el jugador se reconectó
          io.to(roomId).emit('playerReconnected', {
              playerName: username,
              message: `${username} se reconectó.`
          });
      }
      // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲

      // ▼▼▼ USO DE LA NUEVA LÓGICA DE ASIENTOS ▼▼▼
      let emptySeatIndex = -1;
      
      // 1. Intentar usar un asiento reservado por reconexión (si existe y es válido)
      if (effectiveReconnectSeatInfo && room.seats[effectiveReconnectSeatInfo.seatIndex] === null) {
          emptySeatIndex = effectiveReconnectSeatInfo.seatIndex;
          console.log(`[${roomId}] Asignando asiento reservado por reconexión: ${emptySeatIndex}`);
      }
      
      // 2. Si no hay reserva, usar la función inteligente findBestLudoSeat
      if (emptySeatIndex === -1) {
          emptySeatIndex = findBestLudoSeat(room);
      }
      
      // 3. Validación final
      if (emptySeatIndex === -1) {
          return socket.emit('joinRoomFailed', { message: 'La sala está llena.' });
      }
      // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

      // Obtener el color asignado a este asiento físico
      const reservedSeatData = (effectiveReconnectSeatInfo && effectiveReconnectSeatInfo.seatIndex === emptySeatIndex) ? effectiveReconnectSeatInfo.seatData : null;
      const assignedColor = reservedSeatData?.color || room.settings.colorMap[emptySeatIndex];

      // Obtener avatar con fallback mejorado
      let playerAvatar = '';
      if (reservedSeatData && reservedSeatData.avatar) {
          playerAvatar = reservedSeatData.avatar;
      } else if (userInfo && userInfo.avatar_url) {
          playerAvatar = userInfo.avatar_url;
      } else if (userInfo && userInfo.avatar) {
          playerAvatar = userInfo.avatar;
      } else {
          // Avatar por defecto basado en el índice del asiento
          const defaultAvatarIndex = (emptySeatIndex % 10) + 1;
          playerAvatar = `https://i.pravatar.cc/150?img=${defaultAvatarIndex}`;
      }

      room.seats[emptySeatIndex] = {
          playerId: socket.id,
          playerName: reservedSeatData?.playerName || username,
          avatar: playerAvatar, // Avatar con fallback mejorado
          userId: user.userId,
          status: reservedSeatData?.status || ((room.state === 'post-game') ? 'playing' : 'waiting'),
          color: assignedColor
      };

      // ▼▼▼ CORRECCIÓN: Inicializar piezas para jugadores en espera ▼▼▼
      // Si el jugador entra en espera durante una partida en curso, inicializar sus piezas
      if (room.state === 'playing' && room.seats[emptySeatIndex].status === 'waiting' && room.gameState && room.gameState.pieces) {
          // Verificar si las piezas para este color ya están inicializadas
          if (!room.gameState.pieces[assignedColor] || room.gameState.pieces[assignedColor].length === 0) {
              const pieceCount = room.settings.pieceCount || 4;
              const gameType = room.settings.gameType || 'ludo';
              const autoExitSetting = room.settings.autoExit || 'double';
              
              // Inicializar las piezas para este color
              room.gameState.pieces[assignedColor] = [];
              for (let i = 0; i < pieceCount; i++) {
                  let pieceState = 'base';
                  let piecePosition = -1;
                  
                  // Lógica de salida automática SOLO aplica a Ludo con autoExit 'auto'
                  if (gameType === 'ludo' && autoExitSetting === 'auto') {
                      pieceState = 'active';
                      const startPos = room.gameState.board?.start?.[assignedColor];
                      if (startPos !== undefined) {
                          piecePosition = startPos;
                      }
                  }
                  
                  room.gameState.pieces[assignedColor].push({
                      id: `${assignedColor}-${i + 1}`,
                      color: assignedColor,
                      state: pieceState,
                      position: piecePosition,
                  });
              }
              console.log(`[${roomId}] Piezas inicializadas para jugador en espera ${username} (${assignedColor}): ${pieceCount} piezas`);
          }
      }
      // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

      if (effectiveReconnectSeatInfo) {
          ludoClearReconnection(roomId, user.userId);
      }

      socket.join(roomId);
      socket.currentRoomId = roomId;

      console.log(`✅ ${username} se ha unido a la sala ${roomId} en el asiento ${emptySeatIndex}`);

      socket.emit('joinedRoomSuccessfully', {
          roomId: roomId,
          roomName: room.settings.roomName,
          seats: room.seats,
          settings: room.settings,
          mySeatIndex: emptySeatIndex, // El asiento donde se sentó el jugador
          gameState: room.gameState
      });

      // IMPORTANTE: Solo enviamos actualización de asientos, NO afectamos el turno actual
      const roomUpdate = ludoGetSanitizedRoomForClient(room);
      io.to(roomId).emit('playerJoined', roomUpdate);
      broadcastLudoRoomListUpdate(io);
      // ▲▲▲ FIN DE LA ACTUALIZACIÓN DE `joinLudoRoom` ▲▲▲
    });

    // --- CHAT DEL LOBBY DE LUDO ---

    socket.on('sendLobbyChat', (data) => {
        if (!data || !data.text || !data.sender) return;

        const newMessage = {
            id: `msg-ludo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            from: data.sender,
            text: data.text,
            ts: Date.now()
        };

        // Lo guardamos en el historial específico de Ludo
        ludoLobbyChatHistory.push(newMessage);
        ludoChatLastMessageTime = Date.now(); // Actualizar timestamp del último mensaje

        if (ludoLobbyChatHistory.length > LOBBY_CHAT_HISTORY_LIMIT) {
            ludoLobbyChatHistory.shift();
        }

        // Ya no guardamos en DB, solo en memoria
        console.log(`[Chat Ludo] ${data.sender}: ${data.text}`);

        // Lo retransmitimos SOLO a los clientes en el lobby de Ludo
        io.emit('ludoLobbyChatUpdate', newMessage);
    });

    // --- LÓGICA DEL JUEGO LUDO ---

    socket.on('joinLudoGame', (data) => {
      // ▼▼▼ FUNCIÓN 'joinLudoGame' ACTUALIZADA ▼▼▼
      const { roomId, userId } = data;
    
      if (!userId) {
          return socket.emit('ludoError', { message: 'Usuario no identificado.' });
      }
    
      const room = ludoRooms[roomId];
    
      // ▼▼▼ CRÍTICO: Verificar si el jugador fue eliminado por abandono ANTES de permitir reconexión ▼▼▼
      // Si el abandono fue finalizado, NO permitir reconexión - SIMPLE Y DIRECTO
      if (room && room.abandonmentFinalized && room.abandonmentFinalized[userId]) {
          console.log(`[LUDO RECONNECT BLOCKED] ${userId} intentó reconectar pero fue eliminado por abandono después de 2 minutos. NO se permite reconexión.`);
          
          const username = userId.replace('user_', '');
          const bet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';
          
          // ▼▼▼ CRÍTICO: Forzar salida del socket de la sala y limpiar estado antes de redirigir ▼▼▼
          if (socket.currentRoomId === roomId) {
              socket.leave(roomId);
              delete socket.currentRoomId;
              console.log(`[${roomId}] Socket ${socket.id} forzado a salir de la sala después de intento de reconexión con abandono finalizado`);
          }
          // ▲▲▲ FIN LIMPIEZA DE SOCKET ▲▲▲
          
          socket.emit('gameEnded', { 
              reason: 'abandonment', 
              message: `Has sido eliminado por abandono. Se te ha descontado la apuesta de ${bet} ${roomCurrency}.`,
              redirect: true,
              forceExit: true, // Flag extra para forzar salida
              penalty: bet,
              currency: roomCurrency
          });
          return; // NO permitir reconexión - SIMPLE Y DIRECTO
      }
      // ▲▲▲ FIN: BLOQUEO DE RECONEXIÓN DESPUÉS DE ABANDONO ▲▲▲
    
      // ▼▼▼ CRÍTICO: Verificar reconexión SOLO si NO fue eliminado por abandono ▼▼▼
      // Si el jugador está en reconnectSeats (dentro de los 2 minutos), procesar reconexión
      const timeoutKey = `${roomId}_${userId}`;
      if (room && room.reconnectSeats && room.reconnectSeats[userId]) {
          // El jugador está intentando reconectar DENTRO de los 2 minutos, procesar reconexión INMEDIATAMENTE
          console.log(`[LUDO RECONNECT] ${userId} intentó reconectar a sala ${roomId} DENTRO de los 2 minutos. Procesando reconexión...`);
          
          const reservedInfo = room.reconnectSeats[userId];
          const originalSeatIndex = reservedInfo.seatIndex;
          
          // Cancelar timeout de abandono ANTES de restaurar el asiento
          if (ludoReconnectTimeouts[timeoutKey]) {
              clearTimeout(ludoReconnectTimeouts[timeoutKey]);
              delete ludoReconnectTimeouts[timeoutKey];
              console.log(`[Cleanup] Timeout de abandono cancelado para ${userId} en sala ${roomId}`);
          }
          
          if (room.abandonmentTimeouts && room.abandonmentTimeouts[userId]) {
              clearTimeout(room.abandonmentTimeouts[userId]);
              delete room.abandonmentTimeouts[userId];
          }
          
          // Restaurar el asiento si está libre - IMPORTANTE: mantener el status original (playing, no waiting)
          if (room.seats[originalSeatIndex] === null) {
              room.seats[originalSeatIndex] = {
                  ...reservedInfo.seatData,
                  playerId: socket.id, // Actualizar con el nuevo socket.id
                  status: reservedInfo.seatData.status || 'playing' // Mantener el status original (playing, no waiting)
              };
              console.log(`[${roomId}] ${userId} recuperó su asiento ${originalSeatIndex} al reconectarse. Status: ${room.seats[originalSeatIndex].status}, playerId: ${socket.id}`);
          } else {
              // Si el asiento está ocupado, verificar si es el mismo jugador con otro socket.id
              const currentSeat = room.seats[originalSeatIndex];
              if (currentSeat && currentSeat.userId === userId) {
                  // Es el mismo jugador, solo actualizar el playerId
                  currentSeat.playerId = socket.id;
                  console.log(`[${roomId}] ${userId} actualizó su playerId a ${socket.id} en asiento ${originalSeatIndex}`);
              } else {
                  console.warn(`[${roomId}] El asiento ${originalSeatIndex} ya está ocupado por otro jugador. No se puede restaurar.`);
              }
          }
          
          // Limpiar datos de reconexión
          delete room.reconnectSeats[userId];
          if (Object.keys(room.reconnectSeats).length === 0) {
              delete room.reconnectSeats;
          }
          
          // ▼▼▼ LIMPIAR ESTADO DE DESCONEXIÓN: El jugador se reconectó ▼▼▼
          const disconnectKey = `${roomId}_${userId}`;
          if (ludoDisconnectedPlayers[disconnectKey]) {
              delete ludoDisconnectedPlayers[disconnectKey];
              console.log(`[${roomId}] ✓ Estado de desconexión limpiado para ${userId} (jugador se reconectó)`);
          }
          // ▼▼▼ CRÍTICO: Cancelar TODOS los timeouts de inactividad usando userId (no socket.id) ▼▼▼
          const inactivityTimeoutKey = `${roomId}_${userId}`;
          if (ludoInactivityTimeouts[inactivityTimeoutKey]) {
              clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKey]);
              delete ludoInactivityTimeouts[inactivityTimeoutKey];
              console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${userId} (jugador se reconectó, por userId)`);
          }
          // También buscar y cancelar cualquier timeout con socket.id (por si acaso)
          const inactivityTimeoutKeyBySocket = `${roomId}_${socket.id}`;
          if (ludoInactivityTimeouts[inactivityTimeoutKeyBySocket]) {
              clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKeyBySocket]);
              delete ludoInactivityTimeouts[inactivityTimeoutKeyBySocket];
              console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${socket.id} (jugador se reconectó, por socket.id)`);
          }
          // Buscar y cancelar cualquier otro timeout que pueda existir para este jugador
          Object.keys(ludoInactivityTimeouts).forEach(key => {
              if (key.startsWith(`${roomId}_`) && (key.includes(userId) || key.includes(socket.id))) {
                  clearTimeout(ludoInactivityTimeouts[key]);
                  delete ludoInactivityTimeouts[key];
                  console.log(`[${roomId}] ✓ Timeout adicional cancelado: ${key}`);
              }
          });
          // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
          // ▲▲▲ FIN LIMPIEZA ESTADO DESCONEXIÓN ▲▲▲
          
          // Notificar a todos que el jugador se reconectó
          io.to(roomId).emit('playerReconnected', {
              playerName: reservedInfo.seatData.playerName,
              message: `${reservedInfo.seatData.playerName} se reconectó.`
          });
          
          // Actualizar estado del juego para sincronizar al jugador reconectado
          const sanitizedRoom = ludoGetSanitizedRoomForClient(room);
          socket.emit('joinedRoomSuccessfully', {
              roomId: roomId,
              roomName: room.settings.roomName,
              seats: room.seats,
              settings: room.settings,
              mySeatIndex: originalSeatIndex,
              gameState: room.gameState
          });
          
          io.to(roomId).emit('playerJoined', sanitizedRoom);
          
          // ▼▼▼ CRÍTICO: Emitir ludoGameStateUpdated para sincronizar completamente el estado del juego ▼▼▼
          if (room.state === 'playing' && room.gameState) {
              console.log(`[${roomId}] Enviando ludoGameStateUpdated al jugador reconectado ${userId} para sincronizar estado completo.`);
              socket.emit('ludoGameStateUpdated', {
                  newGameState: room.gameState,
                  seats: room.seats,
                  moveInfo: { type: 'reconnect_sync' }
              });
          }
          // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
          
          // IMPORTANTE: Actualizar socket.currentRoomId para que el jugador pueda interactuar
          socket.currentRoomId = roomId;
          socket.join(roomId);
          
          // IMPORTANTE: No continuar con la lógica de asignación de asientos, ya que el asiento fue restaurado
          return;
      }
      // ▲▲▲ FIN DEL BLOQUE DE RECONEXIÓN INMEDIATA ▲▲▲
      
      // Si no está en reconnectSeats, verificar si la sala existe
      if (!room) {
          // La sala ya no existe (probablemente fue limpiada después de abandono)
          console.log(`[LUDO RECONNECT] ${userId} intentó reconectar a sala ${roomId} que ya no existe.`);
          
          // ▼▼▼ CRÍTICO: Verificar si ya fue penalizado antes de enviar gameEnded ▼▼▼
          const globalPenaltyKey = `${roomId}_${userId}`;
          const alreadyPenalized = ludoGlobalPenaltyApplied[globalPenaltyKey];
          
          if (alreadyPenalized) {
              console.log(`[LUDO RECONNECT] ${userId} ya fue penalizado anteriormente. NO se vuelve a cobrar la apuesta.`);
              socket.emit('gameEnded', { 
                  reason: 'room_not_found', 
                  message: 'La sala ya no existe. Ya fuiste penalizado por abandono anteriormente.',
                  redirect: true,
                  alreadyPenalized: true // Indicar que ya fue penalizado
              });
          } else {
              socket.emit('gameEnded', { 
                  reason: 'room_not_found', 
                  message: 'La sala ya no existe. Puede que hayas sido eliminado por abandono.',
                  redirect: true
              });
          }
          // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
          return;
      }
      
      // Verificar si el jugador fue eliminado por abandono (incluso si la sala existe)
      if (room.abandonmentFinalized && room.abandonmentFinalized[userId]) {
          console.log(`[LUDO RECONNECT BLOCKED] ${userId} intentó reconectar pero fue eliminado por abandono. Redirigiendo al lobby.`);
          
          const username = userId.replace('user_', '');
          const bet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';
          
          // ▼▼▼ CRÍTICO: Forzar salida del socket de la sala y limpiar estado antes de redirigir ▼▼▼
          if (socket.currentRoomId === roomId) {
              socket.leave(roomId);
              delete socket.currentRoomId;
              console.log(`[${roomId}] Socket ${socket.id} forzado a salir de la sala después de intento de reconexión con abandono finalizado`);
          }
          // ▲▲▲ FIN LIMPIEZA DE SOCKET ▲▲▲
          
          socket.emit('gameEnded', { 
              reason: 'abandonment', 
              message: `Has sido eliminado por abandono. Se te ha descontado la apuesta de ${bet} ${roomCurrency}.`,
              redirect: true,
              forceExit: true, // Flag extra para forzar salida
              penalty: bet,
              currency: roomCurrency
          });
          return; // NO permitir reconexión
      }

      // ¡CLAVE! Si la sala estaba marcada para eliminación, cancelar
      if (room._cleanupScheduled) {
          console.log(`[${roomId}] Jugador ${userId} se ha reconectado. Cancelando eliminación.`);
          delete room._cleanupScheduled;
      }

      socket.join(roomId);
    
      // ▼▼▼ FIX CRÍTICO: Verificación ya se hizo arriba, pero verificamos también si el juego terminó por abandono ▼▼▼
      // Si el juego está en post-game por abandono, verificar si este jugador fue el que abandonó
      if (room.state === 'post-game' && room.rematchData && room.rematchData.abandonment) {
          // Verificar si este jugador fue el que abandonó (no está en los asientos activos o está marcado como abandonado)
          const wasAbandoner = (room.abandonmentFinalized && room.abandonmentFinalized[userId]) || 
                               !room.seats.some(s => s && s.userId === userId && s.status === 'playing');
          if (wasAbandoner) {
              console.log(`[LUDO RECONNECT BLOCKED] ${userId} intentó reconectar pero el juego ya terminó por su abandono. Redirigiendo al lobby.`);
              
              const username = userId.replace('user_', '');
              const bet = parseFloat(room.settings.bet) || 0;
              const roomCurrency = room.settings.betCurrency || 'USD';
              
              // ▼▼▼ CRÍTICO: Forzar salida del socket de la sala y limpiar estado antes de redirigir ▼▼▼
              if (socket.currentRoomId === roomId) {
                  socket.leave(roomId);
                  delete socket.currentRoomId;
                  console.log(`[${roomId}] Socket ${socket.id} forzado a salir de la sala después de intento de reconexión con abandono finalizado`);
              }
              // ▲▲▲ FIN LIMPIEZA DE SOCKET ▲▲▲
              
              socket.emit('gameEnded', { 
                  reason: 'abandonment', 
                  message: `Has sido eliminado por abandono. Se te ha descontado la apuesta de ${bet} ${roomCurrency}.`,
                  redirect: true,
                  forceExit: true, // Flag extra para forzar salida
                  penalty: bet,
                  currency: roomCurrency
              });
              return; // NO permitir reconexión
          }
      }
      // ▲▲▲ FIN DEL FIX CRÍTICO ▲▲▲
      
      // Si llegamos aquí, el jugador no está en reconnectSeats y la sala existe
      // Continuar con la lógica normal de asignación de asientos (nuevo jugador)
    
      // Buscar el asiento del jugador por su 'userId' (que es el username)
      let mySeatIndex = room.seats.findIndex(s => s && s.userId === userId);

      let playerName = null; // Variable para guardar el nombre

      if (mySeatIndex === -1) {
          // El jugador no está en esta sala, buscar asiento disponible
          console.log(`[${roomId}] ${userId} (Socket ${socket.id}) buscando asiento disponible...`);
        
          // ▼▼▼ VERIFICAR SI ES EL CREADOR DE LA SALA ▼▼▼
          const hostSeatIndex = room.settings.hostSeatIndex;
          // Verificar si es el creador comparando userId (porque el socket.id cambia al reconectarse)
          const isCreator = userId === room.settings.userId;
          
          // Si es el creador y su asiento original está libre, restaurarlo ahí
          if (isCreator && room.seats[hostSeatIndex] === null) {
              mySeatIndex = hostSeatIndex;
              // Actualizar el hostId con el nuevo socket.id del creador
              room.hostId = socket.id;
              console.log(`[${roomId}] ${userId} es el creador de la sala. Restaurando a su asiento original ${hostSeatIndex} y actualizando hostId.`);
          }
          // ▲▲▲ FIN DE LA VERIFICACIÓN DEL CREADOR ▲▲▲
        
          // ▼▼▼ LÓGICA CENTRALIZADA DE ASIGNACIÓN ▼▼▼
          
          // Si el creador ya fue asignado arriba, no hacer nada más
          // Si no, usar la función inteligente findBestLudoSeat
          if (mySeatIndex === -1) {
              mySeatIndex = findBestLudoSeat(room);
          }

          // Validación final
          if (mySeatIndex === -1) {
              return socket.emit('joinRoomFailed', { message: 'La sala está llena.' });
          }
          // ▲▲▲ FIN LÓGICA CENTRALIZADA ▲▲▲
        
          if (mySeatIndex !== -1) {
              // Asignar asiento disponible
              const assignedColor = room.settings.colorMap[mySeatIndex];
              playerName = userId.replace('user_', ''); // <-- Obtener nombre
              // El objeto users tiene claves como 'user_a', 'user_b', etc.
              const userInfo = users[userId.toLowerCase()]; // <-- Obtener info usando userId completo

              // ▼▼▼ ¡AÑADE VALIDACIÓN DE CRÉDITOS AQUÍ! ▼▼▼
              if (room.state === 'post-game') { // Solo si se une a una revancha
                  const bet = parseFloat(room.settings.bet) || 0;
                  const roomCurrency = room.settings.betCurrency || 'USD';
                  if (!userInfo) {
                      console.error(`[JOIN POST-GAME ERROR] No se encontró userInfo para ${playerName} (userId: ${userId}). Usuarios disponibles:`, Object.keys(users));
                      return socket.emit('ludoError', { message: 'Error al verificar créditos.' });
                  }
                  const requiredCreditsInUserCurrency = convertCurrency(bet, roomCurrency, userInfo.currency, exchangeRates);
                  if (userInfo.credits < requiredCreditsInUserCurrency) {
                      console.log(`[JOIN POST-GAME REJECTED] ${playerName} no tiene créditos (${requiredCreditsInUserCurrency.toFixed(2)} ${userInfo.currency}) para unirse a la revancha.`);
                      return socket.emit('ludoError', { message: `No tienes suficientes créditos (${requiredCreditsInUserCurrency.toFixed(2)} ${userInfo.currency}) para unirte.` });
                  }
                  console.log(`[JOIN POST-GAME OK] ${playerName} tiene créditos para unirse a la revancha.`);
              }
              // ▲▲▲ FIN VALIDACIÓN ▲▲▲

              // Obtener avatar con fallback mejorado
              let playerAvatar = '';
              if (userInfo && userInfo.avatar_url) {
                  playerAvatar = userInfo.avatar_url;
              } else if (userInfo && userInfo.avatar) {
                  playerAvatar = userInfo.avatar;
              } else {
                  // Avatar por defecto basado en el índice del asiento
                  const defaultAvatarIndex = (mySeatIndex % 10) + 1;
                  playerAvatar = `https://i.pravatar.cc/150?img=${defaultAvatarIndex}`;
              }

              room.seats[mySeatIndex] = {
                  playerId: socket.id,
                  playerName: playerName, // Usa la variable obtenida
                  avatar: playerAvatar, // Avatar con fallback mejorado
                  userId: userId,
                  // ▼▼▼ ASEGÚRATE DE QUE ESTA LÍNEA ESTÉ ASÍ ▼▼▼
                  status: (room.state === 'playing' || room.state === 'waiting') ? 'waiting' : 'playing', // Únete como 'waiting' si el juego está activo o esperando, 'playing' si está en post-game
                  // ▲▲▲ FIN ▲▲▲
                  color: assignedColor
              };
              console.log(`[${roomId}] ${userId} asignado al asiento ${mySeatIndex} (${assignedColor}) con estado ${room.seats[mySeatIndex].status}`);
              playerName = room.seats[mySeatIndex].playerName; // Guardar nombre
              
              // ▼▼▼ CORRECCIÓN: Inicializar piezas para jugadores en espera ▼▼▼
              // Si el jugador entra en espera durante una partida en curso, inicializar sus piezas
              if (room.state === 'playing' && room.seats[mySeatIndex].status === 'waiting' && room.gameState && room.gameState.pieces) {
                  // Verificar si las piezas para este color ya están inicializadas
                  if (!room.gameState.pieces[assignedColor] || room.gameState.pieces[assignedColor].length === 0) {
                      const pieceCount = room.settings.pieceCount || 4;
                      const gameType = room.settings.gameType || 'ludo';
                      const autoExitSetting = room.settings.autoExit || 'double';
                      
                      // Inicializar las piezas para este color
                      room.gameState.pieces[assignedColor] = [];
                      for (let i = 0; i < pieceCount; i++) {
                          let pieceState = 'base';
                          let piecePosition = -1;
                          
                          // Lógica de salida automática SOLO aplica a Ludo con autoExit 'auto'
                          if (gameType === 'ludo' && autoExitSetting === 'auto') {
                              pieceState = 'active';
                              const startPos = room.gameState.board?.start?.[assignedColor];
                              if (startPos !== undefined) {
                                  piecePosition = startPos;
                              }
                          }
                          
                          room.gameState.pieces[assignedColor].push({
                              id: `${assignedColor}-${i + 1}`,
                              color: assignedColor,
                              state: pieceState,
                              position: piecePosition,
                          });
                      }
                      console.log(`[${roomId}] Piezas inicializadas para jugador en espera ${playerName} (${assignedColor}): ${pieceCount} piezas`);
                  }
              }
              // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
          }
        
          if (mySeatIndex === -1) {
              // No hay asientos disponibles, tratar como espectador
              console.log(`[${roomId}] ${userId} (Socket ${socket.id}) se unió como ESPECTADOR.`);
              socket.currentLudoRoom = roomId;
          } else {
              // Asiento asignado exitosamente
              socket.currentRoomId = roomId;
              socket.userId = userId;
          }
      } else {
          // El jugador SÍ está en la sala, re-asociar su nuevo socket.id
          console.log(`[${roomId}] ${userId} (Socket ${socket.id}) se RE-ASOCIÓ con el asiento ${mySeatIndex}.`);
          room.seats[mySeatIndex].playerId = socket.id;

          playerName = room.seats[mySeatIndex].playerName; // Guardar nombre
        
          // Si es el creador, actualizar el hostId
          if (userId === room.settings.userId) {
              room.hostId = socket.id;
              console.log(`[${roomId}] Creador ${userId} se re-asoció. Actualizando hostId a ${socket.id}.`);
          }
        
          // Actualizar el estado del socket (para futuros disconnects)
          socket.currentRoomId = roomId; 
          socket.userId = room.seats[mySeatIndex].userId;
      }

      // Si el jugador se unió exitosamente a un asiento (no es espectador)
      // Y la sala está en post-game, hay que añadirlo a la lista de revancha.
      if (mySeatIndex !== -1 && room.state === 'post-game' && room.rematchData && playerName) {

          // Añadir automáticamente a los confirmados (si no está ya)
          if (!room.rematchData.confirmedPlayers.includes(playerName)) {
              room.rematchData.confirmedPlayers.push(playerName);
              console.log(`[REMATCH JOIN/RE-ASSOC] ${playerName} añadido a confirmados. Lista: [${room.rematchData.confirmedPlayers.join(', ')}]`);

              // Recalcular si se puede iniciar
              const winnerConfirmed = room.rematchData.confirmedPlayers.includes(room.rematchData.winnerName);
              const expectedPlayers = room.seats.filter(s => s !== null).length; // Total de asientos ocupados AHORA

              if (room.rematchData.confirmedPlayers.length >= 2 && winnerConfirmed) {
                  room.rematchData.canStart = true;
              }

              // Notificar a todos la actualización de la revancha
              io.to(roomId).emit('rematchUpdate', {
                  confirmedPlayers: room.rematchData.confirmedPlayers,
                  canStart: room.rematchData.canStart,
                  winnerName: room.rematchData.winnerName,
                  totalPlayers: expectedPlayers
              });
          } else {
              console.log(`[REMATCH JOIN/RE-ASSOC] ${playerName} ya estaba en la lista de confirmados.`);
          }
      }

      // ▼▼▼ ¡BLOQUE AÑADIDO PARA SINCRONIZACIÓN! ▼▼▼
      // Notifica a TODOS los clientes en la sala sobre el estado actualizado de los asientos.
      // Esto es crucial para la sincronización cuando un jugador carga la página (join/reconnect).
      // IMPORTANTE: Solo enviamos actualización de asientos, NO afectamos el turno actual
      console.log(`[${roomId}] Transmitiendo 'playerJoined' a la sala para sincronizar asientos (en joinLudoGame).`);
      // Enviar solo actualización de asientos sin afectar el estado del turno
      const roomUpdate = ludoGetSanitizedRoomForClient(room);
      io.to(roomId).emit('playerJoined', roomUpdate);

      // ▼▼▼ ¡AÑADE ESTA LÍNEA! ▼▼▼
      // Notifica a TODOS en el lobby que los asientos de esta sala han cambiado.
      broadcastLudoRoomListUpdate(io); 
      // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
      // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

      // Actualizar el estado del usuario en la lista global
      const username = userId.replace('user_', '');
      if (username) {
          // Preservar currentLobby si existe
          const currentLobby = connectedUsers[socket.id]?.currentLobby || null;
          connectedUsers[socket.id] = {
              username: username,
              status: 'Jugando', // Se actualizará en broadcastUserListUpdate con el tipo de juego
              currentLobby: currentLobby
          };
          broadcastUserListUpdate(io);
          console.log(`[Status Update] ${username} (Socket ${socket.id}) se ha unido a un juego. Estado -> Jugando`);
      }

      // ▼▼▼ ¡AÑADE ESTE LOG DETALLADO AQUÍ! ▼▼▼
      console.log(`\n--- [JOIN SERVER EMIT] Intentando emitir 'ludoGameState' a socket ${socket.id} ---`);
      console.log(`  - Room ID: ${room.roomId}`);
      console.log(`  - Room State: ${room.state}`);
      console.log(`  - Target Seat Index: ${mySeatIndex}`);
      console.log(`  - GameState Present?: ${!!room.gameState}`);
      // Log para verificar si el objeto gameState se está enviando
      // Cuidado: esto puede ser muy largo si las piezas están incluidas
      // console.log(`  - Enviando gameState:`, room.gameState); // Descomenta si es necesario
      // ▲▲▲ FIN LOG DETALLADO ▲▲▲

      // Enviar estado actual del juego
      socket.emit('ludoGameState', {
          roomId: room.roomId,
          seats: room.seats,
          state: room.state,
          settings: room.settings,
          mySeatIndex: mySeatIndex, // Enviar el índice del asiento
          currentPlayer: room.currentPlayer || null,
          gameState: room.gameState, // <--- LÍNEA MODIFICADA/AÑADIDA
        
          // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
          rematchData: room.rematchData || null
          // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
      });
      // ▲▲▲ FIN DE LA ACTUALIZACIÓN ▲▲▲
    });

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER PARA ABANDONAR SALA DE LUDO ▼▼▼
    socket.on('leaveLudoGame', (data) => {
      const { roomId } = data;
      
      if (!roomId || !ludoRooms[roomId]) {
        return socket.emit('ludoError', { message: 'Sala no encontrada.' });
      }

      const room = ludoRooms[roomId];
      const seatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
      
      if (seatIndex === -1) {
        // No estaba en un asiento, solo salir de la sala
        socket.leave(roomId);
        delete socket.currentRoomId;
        return;
      }

      // Ejecutar la lógica de abandono
      ludoHandlePlayerDeparture(roomId, socket.id, io);

      // Limpiar estado del socket
      socket.leave(roomId);
      delete socket.currentRoomId;

      // Actualizar estado del usuario a "En el Lobby"
      if (connectedUsers[socket.id]) {
        // Actualizar el estado basándose en el lobby actual
        const currentLobby = connectedUsers[socket.id].currentLobby;
        if (currentLobby) {
            connectedUsers[socket.id].status = `En el lobby de ${currentLobby}`;
        } else {
            connectedUsers[socket.id].status = 'En el Lobby';
        }
        broadcastUserListUpdate(io);
      }

      // Notificar al cliente que salió exitosamente
      socket.emit('leftLudoGame', { roomId });
      
      console.log(`[LEAVE LUDO] Usuario ${connectedUsers[socket.id]?.username || socket.id} abandonó la sala ${roomId}.`);
    });
    // ▲▲▲ FIN DEL NUEVO LISTENER ▲▲▲

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER COMPLETO ▼▼▼
    socket.on('ludoStartGame', async (data) => {
      const { roomId } = data;
      const room = ludoRooms[roomId];

      if (!room) return socket.emit('ludoError', { message: 'Sala no encontrada.' });
      if (room.state !== 'waiting') return socket.emit('ludoError', { message: 'El juego ya ha comenzado.' });
    
      // ▼▼▼ LÍNEA MODIFICADA ▼▼▼
      // Validamos usando el userId del asiento del host (hostSeatIndex)
      const hostSeatIndex = room.settings.hostSeatIndex;
      const hostSeat = room.seats[hostSeatIndex];
      if (!hostSeat || hostSeat.playerId !== socket.id) { 
          // Comprobamos si el socket actual coincide con el playerId del asiento del host
          return socket.emit('ludoError', { message: 'Solo el anfitrión puede iniciar el juego.' });
      }
      // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲

      const seatedPlayers = room.seats.filter(s => s !== null);
    
      // ▼▼▼ REEMPLAZA el 'if (seatedPlayers.length < 2)' CON ESTE BLOQUE COMPLETO ▼▼▼
      const gameType = room.settings.gameType;
      const parchisMode = room.settings.parchisMode;

      if (gameType === 'parchis' && parchisMode === '4-groups') {
          // REGLA 1: Partida de parejas REQUIERE 4 jugadores
          if (seatedPlayers.length !== 4) {
              return socket.emit('ludoError', { message: 'Se necesitan exactamente 4 jugadores para iniciar una partida de parejas.' });
          }
      } else if (gameType === 'parchis' && parchisMode === '2-individual') {
          // REGLA 2 (Añadida): 1 vs 1 REQUIERE 2 jugadores
          if (seatedPlayers.length !== 2) {
              return socket.emit('ludoError', { message: 'Se necesitan exactamente 2 jugadores para iniciar una partida 1 vs 1.' });
          }
      } else if (seatedPlayers.length < 2) {
          // REGLA 3 (Default): Ludo o Parchís Individual
          return socket.emit('ludoError', { message: 'Se necesitan al menos 2 jugadores para empezar.' });
      }
      // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

      console.log(`[${roomId}] El anfitrión ${socket.id} ha iniciado el juego.`);

      const bet = parseFloat(room.settings.bet) || 0;
      const totalCostInRoomCurrency = bet;
      let totalPot = 0;
      let failedPlayers = [];

      // --- FASE 1: VALIDAR CRÉDITOS ---
      for (const seat of seatedPlayers) {
          // ▼▼▼ CORRECCIÓN CRÍTICA: Usar userId directamente (user_username) ▼▼▼
          const userInfo = users[seat.userId];
          if (!userInfo) {
              console.error(`❌ No se encontró userInfo para ${seat.playerName} (buscando como ${seat.userId}). Usuarios disponibles:`, Object.keys(users));
              failedPlayers.push({ name: seat.playerName, reason: 'Información no encontrada.' });
              continue;
          }
          // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

          const totalCostInUserCurrency = convertCurrency(totalCostInRoomCurrency, room.settings.betCurrency, userInfo.currency, exchangeRates);

          if (userInfo.credits < totalCostInUserCurrency) {
              failedPlayers.push({ name: seat.playerName, reason: 'Créditos insuficientes.' });
          }
      }

      if (failedPlayers.length > 0) {
          const errorMsg = 'No se puede iniciar el juego. Jugadores sin fondos: ' + failedPlayers.map(p => p.name).join(', ');
          console.warn(`[${roomId}] Fallo al iniciar: ${errorMsg}`);
          return socket.emit('ludoError', { message: errorMsg });
      }

      // --- FASE 2: COBRAR Y ACTUALIZAR ESTADO ---
      const playersAtStart = []; // <-- AÑADE ESTA LÍNEA
      for (const seat of seatedPlayers) {
          // ▼▼▼ CORRECCIÓN CRÍTICA: Usar userId directamente (user_username) ▼▼▼
          const userInfo = users[seat.userId];
          if (!userInfo) {
              console.error(`❌ No se encontró userInfo para ${seat.playerName} en FASE 2 (buscando como ${seat.userId})`);
              continue;
          }
          // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
          const totalCostInUserCurrency = convertCurrency(totalCostInRoomCurrency, room.settings.betCurrency, userInfo.currency, exchangeRates);

          // 1. Restar créditos
          userInfo.credits -= totalCostInUserCurrency;

          // ▼▼▼ CORRECCIÓN CRÍTICA: Persistir el cambio de créditos ▼▼▼
          await updateUserCredits(seat.userId, userInfo.credits, userInfo.currency);
          console.log(`[${roomId}] COBRO REALIZADO: ${seat.playerName} pagó ${totalCostInUserCurrency.toFixed(2)} ${userInfo.currency} (Equivalente a ${totalCostInRoomCurrency.toFixed(2)} ${room.settings.betCurrency}). Saldo nuevo: ${userInfo.credits.toFixed(2)} ${userInfo.currency}.`);
          // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

          // 2. Sumar al bote (convertido a la moneda de la sala)
          totalPot += totalCostInRoomCurrency;

          // 3. Notificar al jugador su nuevo saldo
          // (Encontramos el socket.id del jugador, que puede haber cambiado)
          const playerSocket = io.sockets.sockets.get(seat.playerId);
          if (playerSocket) {
              playerSocket.emit('userStateUpdated', userInfo);
          }

          // 4. Marcar al jugador como 'jugando'
          seat.status = 'playing';
          playersAtStart.push(seat.playerName); // <-- AÑADE ESTA LÍNEA
      }

      // 5. Actualizar el estado del juego en el servidor
      room.state = 'playing';
      room.gameState.pot = totalPot;
      room.gameState.playersAtStart = playersAtStart; // <-- AÑADE ESTA LÍNEA
      room.gameState.turn.playerIndex = room.settings.hostSeatIndex; // El anfitrión empieza
      room.gameState.turn.canRoll = true;

      console.log(`[${roomId}] Juego iniciado. Bote: ${totalPot} ${room.settings.betCurrency}. Turno: Asiento ${room.settings.hostSeatIndex}`);

      // 6. Transmitir el inicio del juego a todos
      io.to(roomId).emit('ludoGameStarted', {
          gameState: room.gameState,
          seats: room.seats
      });

      // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
      // Notifica a TODOS en el lobby que el estado de esta sala cambió a 'playing'
      broadcastLudoRoomListUpdate(io);
      // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
    });
    // ▲▲▲ FIN DEL LISTENER AÑADIDO ▲▲▲

    // ▼▼▼ LÓGICA DE DADOS ACTUALIZADA (CON CÁLCULO DE MOVIMIENTOS) ▼▼▼
    socket.on('ludoRollDice', (data) => {
      try {
      const { roomId } = data;
      const room = ludoRooms[roomId];
    
      // ▼▼▼ ¡AÑADE ESTE LOG DETALLADO! ▼▼▼
      console.log(`\n--- [ROLL DICE SERVER] Recibido 'ludoRollDice' ---`);
      console.log(`  - Socket ID: ${socket.id}`);
      console.log(`  - Room ID recibido: ${roomId}`);
      console.log(`  - Estado actual de la sala (${roomId}): ${room ? room.state : 'NO ENCONTRADA'}`);
      // ▲▲▲ FIN LOG DETALLADO ▲▲▲
    
      if (!room) return socket.emit('ludoError', { message: 'Sala no encontrada.' });
      if (room.state !== 'playing') {
          console.error(`[${roomId}] Error al lanzar dados: Estado de la sala es '${room.state}', no 'playing'.`);
          return socket.emit('ludoError', { message: 'El juego no ha comenzado.' });
      }
    
      // Buscar asiento por socket.id primero, luego por userId (para casos de reconexión)
      const userId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
      let mySeatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
      
      // Si no se encuentra por socket.id, buscar por userId (reconexión)
      if (mySeatIndex === -1 && userId) {
          mySeatIndex = room.seats.findIndex(s => s && s.userId === userId);
          // Si se encuentra por userId, actualizar el playerId con el nuevo socket.id
          if (mySeatIndex !== -1) {
              room.seats[mySeatIndex].playerId = socket.id;
              console.log(`[${roomId}] Actualizado playerId del asiento ${mySeatIndex} a ${socket.id} para userId ${userId} (ludoRollDice)`);
          }
      }
      
      // ▼▼▼ CANCELAR TIMEOUT DE INACTIVIDAD Y LIMPIAR ESTADO DE DESCONEXIÓN: El jugador está actuando ▼▼▼
      // CRÍTICO: Usar userId en lugar de socket.id para cancelar correctamente el timeout
      if (userId) {
          const inactivityTimeoutKey = `${roomId}_${userId}`;
          if (ludoInactivityTimeouts[inactivityTimeoutKey]) {
              clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKey]);
              delete ludoInactivityTimeouts[inactivityTimeoutKey];
              console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${userId} (jugador tiró los dados)`);
          }
          
          // También buscar y cancelar cualquier timeout con socket.id (por si acaso)
          const inactivityTimeoutKeyBySocket = `${roomId}_${socket.id}`;
          if (ludoInactivityTimeouts[inactivityTimeoutKeyBySocket]) {
              clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKeyBySocket]);
              delete ludoInactivityTimeouts[inactivityTimeoutKeyBySocket];
              console.log(`[${roomId}] ✓ Timeout de inactividad cancelado (por socket.id) para ${socket.id}`);
          }
          
          // Limpiar estado de desconexión si existe (el jugador está actuando, ya no está desconectado)
          const disconnectKey = `${roomId}_${userId}`;
          if (ludoDisconnectedPlayers[disconnectKey]) {
              delete ludoDisconnectedPlayers[disconnectKey];
              console.log(`[${roomId}] ✓ Estado de desconexión limpiado para ${userId} (jugador tiró los dados)`);
          }
      }
      // ▲▲▲ FIN CANCELACIÓN TIMEOUT Y LIMPIEZA ▲▲▲
      
      if (mySeatIndex === -1) {
          // Buscar por userId para verificar si fue eliminado por abandono
          if (userId && room.abandonmentFinalized && room.abandonmentFinalized[userId]) {
              const bet = parseFloat(room.settings.bet) || 0;
              const roomCurrency = room.settings.betCurrency || 'USD';
              socket.emit('gameEnded', { 
                  reason: 'abandonment', 
                  message: `Has sido eliminado por abandono. Se te ha descontado la apuesta de ${bet} ${roomCurrency}.`,
                  redirect: true,
                  penalty: bet,
                  currency: roomCurrency
              });
              return;
          }
          return socket.emit('ludoError', { message: 'No estás sentado en esta mesa.' });
      }
      
      const mySeat = room.seats[mySeatIndex];
      // Verificar si el jugador fue eliminado por abandono
      if (mySeat && mySeat.userId && room.abandonmentFinalized && room.abandonmentFinalized[mySeat.userId]) {
          const bet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';
          socket.emit('gameEnded', { 
              reason: 'abandonment', 
              message: `Has sido eliminado por abandono. Se te ha descontado la apuesta de ${bet} ${roomCurrency}.`,
              redirect: true,
              penalty: bet,
              currency: roomCurrency
          });
          return;
      }

      // --- VALIDACIÓN: Jugador en espera no puede interactuar ---
      if (mySeat && mySeat.status === 'waiting') {
          return socket.emit('ludoError', { message: 'Estás en espera para la siguiente partida. No puedes jugar ahora.' });
      }

      // --- VALIDACIÓN DE TURNO ---
      if (room.gameState.turn.playerIndex !== mySeatIndex) {
          return socket.emit('ludoError', { message: 'No es tu turno.' });
      }
      if (!room.gameState.turn.canRoll) {
          return socket.emit('ludoError', { message: 'Ya has lanzado, debes mover.' });
      }

      // ▼▼▼ AÑADE ESTE BLOQUE ▼▼▼
      // Notifica a TODOS que este jugador está lanzando los dados AHORA
      const playerName = room.seats[mySeatIndex].playerName;
      io.to(roomId).emit('ludoDiceRolling', {
          playerId: socket.id,
          playerName: playerName
      });
      console.log(`[${roomId}] Notificando que ${playerName} está lanzando...`);
      // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

      // --- GENERAR DADOS ---
      const dice1 = Math.floor(Math.random() * 6) + 1;
      const dice2 = Math.floor(Math.random() * 6) + 1;
      // ▼▼▼ LOG DE GENERACIÓN ▼▼▼
      console.log(`[SERVER DICE GEN] Dados generados: ${dice1}, ${dice2}`);
      // ▲▲▲ FIN LOG ▲▲▲
      io.to(roomId).emit('playSound', 'dados'); // Sonido al lanzar los dados

      const gameType = room.settings?.gameType || 'ludo';
      if (gameType === 'parchis') {
          return ludoHandleParchisRoll(room, io, socket, dice1, dice2);
      }

      const isDouble = (dice1 === dice2);
    
      const playerColor = room.seats[mySeatIndex].color;
      console.log(`[${roomId}] ${playerName} (${playerColor}) lanzó: ${dice1}-${dice2}${isDouble ? ' (DOBLE)' : ''}`);

      // --- LÓGICA DE DOBLES Y SALIDA DE CASA ---
      const pieces = room.gameState.pieces[playerColor];
      const basePieces = pieces.filter(p => p.state === 'base');
      let piecesMovedOut = []; // Para registrar qué piezas salieron

      if (isDouble && basePieces.length > 0) {
          // *** REGLA ESPECIAL: UNA FICHA MUERTA VS MÚLTIPLES FICHAS MUERTAS ***
          if (basePieces.length === 1) {
              // Solo una ficha muerta: se desbloquea un dado del doble
              console.log(`[${roomId}] ¡DOBLE! Solo una ficha muerta. Desbloqueando un dado del doble.`);
              const startPosition = room.gameState.board.start[playerColor];
            
              // Sacar la única ficha muerta
              const singlePiece = basePieces[0];
              singlePiece.state = 'active';
              singlePiece.position = startPosition;
              piecesMovedOut.push(singlePiece.id);
            
              console.log(`[${roomId}] ${singlePiece.id} sale a ${startPosition}. Comprobando muertes.`);
            
              // Verificar muertes
              for (const color in room.gameState.pieces) {
                  if (color === playerColor) continue;
                  room.gameState.pieces[color].forEach(opponentPiece => {
                      if (opponentPiece.state === 'active' && opponentPiece.position === startPosition) {
                          opponentPiece.state = 'base';
                          opponentPiece.position = -1;
                          console.log(`[${roomId}] ¡${singlePiece.id} mató a ${opponentPiece.id}!`);
                      }
                  });
              }
            
              // Desbloquear un dado del doble para jugar con cualquier ficha
              const diceValue = Math.max(dice1, dice2); // Usar el dado mayor (o cualquiera si son iguales)

              // 1. Actualiza el estado del turno ANTES de emitir
              room.gameState.turn.dice = [dice1, dice2]; // Guarda los dados que salieron
              room.gameState.turn.moves = [diceValue];  // Solo un dado disponible
              room.gameState.turn.canRoll = false;      // Debe mover, no tirar de nuevo AHORA
              room.gameState.turn.canRollAgain = true; // Guarda el bono del doble
              room.gameState.turn.possibleMoves = [];   // Limpiar (se recalcularán si es necesario)

              // 1.1 (Opcional pero recomendado) Calcular movimientos posibles AHORA con el dado desbloqueado
              const activePiecesAfterExit = pieces.filter(p => p.state === 'active');
              activePiecesAfterExit.forEach(piece => {
              const result = ludoCalculatePath(playerColor, piece.position, diceValue, room.gameState.board, room.gameState.pieces, gameType);
                  if (result.finalPosition !== null) {
                      // Aquí podrías añadir la lógica de validación de 'kill moves' si aplica
                      room.gameState.turn.possibleMoves.push({
                          type: 'move_active_piece', pieceId: piece.id, diceValue: diceValue, targetPosition: result.finalPosition
                      });
                  }
              });
               console.log(`[${roomId}] Movimientos posibles con dado ${diceValue}:`, room.gameState.turn.possibleMoves);


              // 2. EMITE 'ludoDiceRolled' INMEDIATAMENTE para detener la animación del cliente
              io.to(roomId).emit('ludoDiceRolled', {
                  playerId: socket.id,
                  playerName: playerName,
                  diceValues: [dice1, dice2], // Envía los valores reales que salieron
                  isDouble: true,             // Indica que fue un doble
                  turnData: room.gameState.turn // Envía el estado actualizado (canRoll=false, moves=[dado])
              });
               console.log(`[${roomId}] Emitiendo ludoDiceRolled para detener animación (single piece exit).`);

              // 3. Mantiene el setTimeout para actualizar la POSICIÓN VISUAL de la ficha
              setTimeout(() => {
                  if (ludoRooms[roomId] && ludoRooms[roomId].state === 'playing') {
                      console.log(`[${roomId}] Enviando actualización del tablero después del retraso (single piece exit).`);
                      io.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState, // El estado ya tiene la ficha movida
                          moveInfo: { type: 'auto_release_single', playerColor, piecesMoved: piecesMovedOut, newPosition: startPosition } // No enviamos 'diceUnlocked' aquí
                      });
                  }
              }, 1200); // Mantenemos el retraso para la animación de la ficha
            
          } else {
              // Múltiples fichas muertas: comportamiento normal
              console.log(`[${roomId}] ¡DOBLE! Sacando ${basePieces.length} ficha(s) de ${playerColor} de la base.`);
              const startPosition = room.gameState.board.start[playerColor];
        
          basePieces.forEach(piece => {
              piece.state = 'active';
              piece.position = startPosition;
              piecesMovedOut.push(piece.id);

              // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO ▼▼▼
              console.log(`[${roomId}] ${piece.id} sale a ${startPosition}. Comprobando muertes.`);

              // Iterar sobre todos los colores
              for (const color in room.gameState.pieces) {
                  if (color === playerColor) continue; // Saltar mis propias fichas

                  // Revisar las fichas del oponente
                  room.gameState.pieces[color].forEach(opponentPiece => {
                      // Si una ficha oponente está activa en nuestra casilla de salida...
                      if (opponentPiece.state === 'active' && opponentPiece.position === startPosition) {
                          // ...la matamos
                          opponentPiece.state = 'base';
                          opponentPiece.position = -1;
                          console.log(`[${roomId}] ¡MATANZA AL SALIR! ${piece.id} ha comido a ${opponentPiece.id} en ${startPosition}`);
                      }
                  });
              }
              // (Nota: Las reglas de "matar al salir" no suelen dar un turno extra)
              // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲
          });

          // Actualizar estado del turno: Se vuelve a tirar INMEDIATAMENTE
          room.gameState.turn.canRoll = true; // Puede volver a tirar
          room.gameState.turn.canRollAgain = false; // El beneficio del doble se usó para salir y volver a tirar
          room.gameState.turn.dice = [dice1, dice2]; // Guardamos el doble que sacó
          room.gameState.turn.moves = []; // No hay movimientos pendientes con este doble
          room.gameState.turn.possibleMoves = []; // No hay movimientos a elegir

          // Transmitir el resultado de los dados (el doble)
          io.to(roomId).emit('ludoDiceRolled', {
              playerId: socket.id,
              playerName: playerName,
              diceValues: [dice1, dice2],
              isDouble: true,
              turnData: room.gameState.turn // Estado actualizado: canRoll = true
          });

              // ▼▼▼ INICIO DE LA MODIFICACIÓN (RETRASO) ▼▼▼
              // Espera antes de enviar la actualización del tablero
              const RELEASE_DELAY = 1200; // Ajustado (1000ms de animación del cliente + 200ms de margen)
              console.log(`[${roomId}] Esperando ${RELEASE_DELAY}ms para mover fichas de la base...`);

              setTimeout(() => {
                  // Asegúrate de que la sala todavía existe y el estado es relevante
                  if (ludoRooms[roomId] && ludoRooms[roomId].state === 'playing') {
                      console.log(`[${roomId}] Enviando actualización del tablero después del retraso.`);
                      io.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState, // El estado ya fue actualizado antes
                          moveInfo: { type: 'auto_release_all', playerColor, piecesMoved: piecesMovedOut, newPosition: startPosition }
                      });
                  }
              }, RELEASE_DELAY);
              // ▲▲▲ FIN DE LA MODIFICACIÓN (RETRASO) ▲▲▲
          }

      } else {
          // *** CASO NORMAL (NO DOBLE O SIN FICHAS EN CASA) ***
          let possibleMoves = [];
          const activePieces = pieces.filter(p => p.state === 'active');
          const diceValuesToUse = [dice1, dice2]; // Dados disponibles
        
          // ▼▼▼ INICIO: CÁLCULO DE MOVIMIENTOS (CON REGLAS MEJORADAS) ▼▼▼
          console.log(`[${roomId}] Calculando movimientos para ${playerName} (${playerColor}) con dados ${dice1}-${dice2}`);

          const allPieces = room.gameState.pieces;
          const boardRules = room.gameState.board;
          const allSafeSquares = [...boardRules.safe, ...boardRules.startSafe];

          // --- Funciones de Ayuda para la simulación ---

          // Función 1: Comprueba si un movimiento es un "Kill Move"
          const isKillMove = (targetPos, color) => {
              if (allSafeSquares.includes(targetPos)) return false; // No se mata en casillas seguras
              for (const c in allPieces) {
                  if (c === color) continue;
                  if (allPieces[c].some(p => p.state === 'active' && p.position === targetPos)) {
                      return true; // Encontró una ficha oponente
                  }
              }
              return false;
          };

          // Función 2: Comprueba si el 'otro' dado puede ser jugado por 'otra' ficha
          const canPlayOtherDie = (otherDie, pieceToExcludeId) => {
              // Itera sobre todas las piezas activas EXCEPTO la que va a matar
              const otherPieces = pieces.filter(p => p.state === 'active' && p.id !== pieceToExcludeId);
              for (const otherPiece of otherPieces) {
                  const { finalPosition } = ludoCalculatePath(playerColor, otherPiece.position, otherDie, boardRules, room.gameState.pieces, gameType);
                  if (finalPosition !== null) {
                      return true; // ¡Encontró un movimiento válido!
                  }
              }
              return false; // No se encontró ningún movimiento para el otro dado
          };

          // Función 3: Verifica si una ficha puede llegar a la meta
          const canReachGoal = (piece, diceValue) => {
              const result = ludoCalculatePath(playerColor, piece.position, diceValue, boardRules, room.gameState.pieces, gameType);
              return result.finalPosition === 99; // 99 es la meta
          };

          // --- Fin Funciones de Ayuda ---

          // ▼▼▼ LÓGICA NORMAL PARA MÚLTIPLES FICHAS ACTIVAS ▼▼▼
          activePieces.forEach(piece => {
              const dice = [dice1, dice2];

              // 1. Comprobar movimientos de dados individuales
              dice.forEach((dieValue, index) => {
                  if (index === 1 && dice[0] === dice[1]) return; // Evitar procesar el segundo dado si es un doble

                  const otherDieValue = dice[index === 0 ? 1 : 0];
              const result = ludoCalculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, gameType);

                  if (result.finalPosition !== null) {
                      let isValid = true;
                      // Es un Kill Move?
                      // ▼▼▼ CORRECCIÓN: Pasar todos los parámetros requeridos a ludoIsKillMove ▼▼▼
                      if (ludoIsKillMove(result.finalPosition, playerColor, room.gameState.pieces, boardRules)) {
                          // Sí. Comprobar Prerrequisito (Regla 2)
                          // MODIFICACIÓN: Esta regla (no poder matar si no puedes mover el otro dado)
                          // SOLO aplica a LUDO. En Parchís se permite porque el bono de 20 cambia todo.
                          if (gameType !== 'parchis' && !canPlayOtherDie(otherDieValue, piece.id)) {
                              isValid = false; // Inválido en LUDO.
                              console.log(`[${roomId}] RECHAZADO (Regla 2 LUDO): Mover ${piece.id} con ${dieValue} (MATA) pero no se puede jugar ${otherDieValue}`);
                          }
                      }
                      // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

                      if (isValid) {
                          possibleMoves.push({
                              type: 'move_active_piece', pieceId: piece.id, diceValue: dieValue, targetPosition: result.finalPosition
                          });
                      }
                  }
              });

              // 2. Comprobar movimiento con la SUMA (AHORA INCLUYE DOBLES)
              const sumDice = dice1 + dice2;
              const resultSum = ludoCalculatePath(playerColor, piece.position, sumDice, boardRules, room.gameState.pieces, gameType);
              if (resultSum.finalPosition !== null) {
                   // La Regla 2 no aplica a la suma, es un movimiento directo
                   possibleMoves.push({
                       type: 'move_active_piece', pieceId: piece.id, diceValue: sumDice, targetPosition: resultSum.finalPosition
                   });
              }
          });
        
          // ▼▼▼ CASO ESPECIAL: OBLIGATORIO JUGAR DADO MAYOR SI NO PUEDE JUGAR SUMA ▼▼▼
          // Si solo hay una ficha activa y puede jugar el dado mayor pero no la suma, es obligatorio
          if (activePieces.length === 1 && dice1 !== dice2) {
              const singlePiece = activePieces[0];
              const maxDie = Math.max(dice1, dice2);
              const sumDice = dice1 + dice2;
            
              const canPlaySum = ludoCalculatePath(playerColor, singlePiece.position, sumDice, boardRules, room.gameState.pieces, gameType).finalPosition !== null;
              const canPlayMax = ludoCalculatePath(playerColor, singlePiece.position, maxDie, boardRules, room.gameState.pieces, gameType).finalPosition !== null;
            
              if (canPlayMax && !canPlaySum) {
                  console.log(`[${roomId}] CASO ESPECIAL: ${singlePiece.id} debe jugar obligatoriamente dado mayor ${maxDie} (no puede jugar suma ${sumDice})`);
                  // Filtrar solo el movimiento del dado mayor
                  possibleMoves = possibleMoves.filter(move => 
                      move.pieceId === singlePiece.id && move.diceValue === maxDie
                  );
              }
          }
          // ▲▲▲ FIN: CÁLCULO DE MOVIMIENTOS (CON REGLAS MEJORADAS) ▲▲▲

          // Actualizar estado del turno
          room.gameState.turn.dice = [dice1, dice2];
          room.gameState.turn.canRoll = false; // Ahora debe mover (si hay movimientos)
          room.gameState.turn.canRollAgain = isDouble; // Podrá volver a tirar DESPUÉS de mover si sacó doble aquí
          room.gameState.turn.moves = [dice1, dice2];
          room.gameState.turn.possibleMoves = possibleMoves;
          // ▼▼▼ LOG DE ALMACENAMIENTO ▼▼▼
          console.log(`[SERVER DICE STORE] Almacenando dados en turn.moves: ${room.gameState.turn.moves.join(', ')}`);
          // ▲▲▲ FIN LOG ▲▲▲

          console.log(`[${roomId}] Movimientos posibles para ${playerName}:`, possibleMoves);

          // Comprobar si se debe pasar el turno automáticamente
          if (possibleMoves.length === 0 && !isDouble) {
              // No sacó doble y NO tiene movimientos posibles
              console.log(`[${roomId}] ${playerName} no tiene movimientos válidos. Pasando turno...`);
              // ▼▼▼ LOG ANTES DE EMIT ▼▼▼
              console.log(`[SERVER DICE EMIT] Enviando ludoDiceRolled con diceValues: ${dice1}, ${dice2} y turnData.moves: ${room.gameState.turn.moves.join(', ')}`);
              // ▲▲▲ FIN LOG ▲▲▲
            
              io.to(roomId).emit('ludoDiceRolled', {
                  playerId: socket.id,
                  playerName: playerName,
                  diceValues: [dice1, dice2],
                  isDouble: false,
                  turnData: room.gameState.turn 
              });
            
              // ▼▼▼ MODIFICA ESTA LÍNEA ▼▼▼
              setTimeout(() => { ludoPassTurn(room, io); }, 2200); // 1s anim + 1s espera + 0.2s buffer
              // ▲▲▲ FIN ▲▲▲

          } else if (possibleMoves.length === 0 && isDouble) {
               // Sacó doble pero no tiene fichas activas para mover (todas están en casa o meta)
               console.log(`[${roomId}] ${playerName} sacó doble pero no tiene fichas activas. Vuelve a tirar.`);
               room.gameState.turn.canRoll = true; // Permite tirar de nuevo
               room.gameState.turn.canRollAgain = false; // Ya se usó el beneficio
               room.gameState.turn.moves = [];
               room.gameState.turn.possibleMoves = [];
               // ▼▼▼ LOG ANTES DE EMIT ▼▼▼
               console.log(`[SERVER DICE EMIT] Enviando ludoDiceRolled con diceValues: ${dice1}, ${dice2} y turnData.moves: ${room.gameState.turn.moves.join(', ')}`);
               // ▲▲▲ FIN LOG ▲▲▲

               io.to(roomId).emit('ludoDiceRolled', {
                   playerId: socket.id,
                   playerName: playerName,
                   diceValues: [dice1, dice2],
                   isDouble: true,
                   turnData: room.gameState.turn // canRoll = true
               });
               // No se pasa el turno

          } else {
              // Hay movimientos posibles
              // ▼▼▼ LOG ANTES DE EMIT ▼▼▼
              console.log(`[SERVER DICE EMIT] Enviando ludoDiceRolled con diceValues: ${dice1}, ${dice2} y turnData.moves: ${room.gameState.turn.moves.join(', ')}`);
              // ▲▲▲ FIN LOG ▲▲▲
            
              io.to(roomId).emit('ludoDiceRolled', {
                  playerId: socket.id,
                  playerName: playerName,
                  diceValues: [dice1, dice2],
                  isDouble: isDouble,
                  turnData: room.gameState.turn
              });
          }
      }
      } catch (error) {
        console.error("🔥 ERROR CRÍTICO EN ludoRollDice:", error);
        socket.emit('ludoError', { message: 'Error interno del servidor al lanzar dados.' });
      }
  });
    // ▲▲▲ FIN DE LA LÓGICA DE DADOS ▲▲▲

    // ▼▼▼ LISTENER DE MOVIMIENTO DE FICHA ACTUALIZADO ▼▼▼
    socket.on('ludoMovePiece', async (data) => {
      try {
      const { roomId, move } = data; // 'move' contendrá { type: 'move_from_base', pieceId: 'yellow-1' }
      const room = ludoRooms[roomId];
    
      // ▼▼▼ AÑADE ESTE BLOQUE ▼▼▼
      if (room && room.gameState.turn.isMoving) {
          console.warn(`[${roomId}] RECHAZADO: Se recibió un movimiento mientras otro estaba en progreso.`);
          return socket.emit('ludoError', { message: 'Espera a que termine el movimiento anterior.' });
      }
      // ▲▲▲ FIN DEL BLOQUE ▲▲▲

      if (!room) return socket.emit('ludoError', { message: 'Sala no encontrada.' });
      if (room.state !== 'playing') return socket.emit('ludoError', { message: 'El juego no ha comenzado.' });

      // Buscar asiento por socket.id primero, luego por userId (para casos de reconexión)
      const userId = socket.userId || (socket.handshake && socket.handshake.auth && socket.handshake.auth.userId);
      let mySeatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
      
      // ▼▼▼ CANCELAR TIMEOUT DE INACTIVIDAD Y LIMPIAR ESTADO DE DESCONEXIÓN: El jugador está moviendo una ficha ▼▼▼
      const inactivityTimeoutKey = `${roomId}_${socket.id}`;
      if (ludoInactivityTimeouts[inactivityTimeoutKey]) {
          clearTimeout(ludoInactivityTimeouts[inactivityTimeoutKey]);
          delete ludoInactivityTimeouts[inactivityTimeoutKey];
          console.log(`[${roomId}] ✓ Timeout de inactividad cancelado para ${socket.id} (jugador movió una ficha)`);
      }
      // Limpiar estado de desconexión si existe (el jugador está actuando, ya no está desconectado)
      if (userId) {
          const disconnectKey = `${roomId}_${userId}`;
          if (ludoDisconnectedPlayers[disconnectKey]) {
              delete ludoDisconnectedPlayers[disconnectKey];
              console.log(`[${roomId}] ✓ Estado de desconexión limpiado para ${userId} (jugador movió una ficha)`);
          }
      }
      // ▲▲▲ FIN CANCELACIÓN TIMEOUT Y LIMPIEZA ▲▲▲
      
      // Si no se encuentra por socket.id, buscar por userId (reconexión)
      if (mySeatIndex === -1 && userId) {
          mySeatIndex = room.seats.findIndex(s => s && s.userId === userId);
          // Si se encuentra por userId, actualizar el playerId con el nuevo socket.id
          if (mySeatIndex !== -1) {
              room.seats[mySeatIndex].playerId = socket.id;
              console.log(`[${roomId}] Actualizado playerId del asiento ${mySeatIndex} a ${socket.id} para userId ${userId}`);
          }
      }
      
      if (mySeatIndex === -1) return socket.emit('ludoError', { message: 'No estás sentado.' });
      
      // --- VALIDACIÓN: Jugador en espera no puede interactuar ---
      const mySeat = room.seats[mySeatIndex];
      if (mySeat && mySeat.status === 'waiting') {
          return socket.emit('ludoError', { message: 'Estás en espera para la siguiente partida. No puedes mover fichas ahora.' });
      }
      
      if (room.gameState.turn.playerIndex !== mySeatIndex) return socket.emit('ludoError', { message: 'No es tu turno.' });

      const seatColor = room.seats[mySeatIndex].color;
      const playerName = room.seats[mySeatIndex].playerName; // <-- AÑADE ESTA LÍNEA
      const turnData = room.gameState.turn;
      const boardRules = room.gameState.board;
      const gameType = room.settings.gameType || 'ludo';
      const playerColor = ludoGetControlledColorForSeat(room, mySeatIndex) || seatColor;
      const isGroupsMode = gameType === 'parchis' && room.settings.parchisMode === '4-groups';
      if (isGroupsMode && playerColor !== seatColor) {
          console.log(`[${roomId}] ${playerName} controla temporalmente las fichas ${playerColor} (pareja de ${seatColor}).`);
      }
      // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
      const gameStateRefForTurnStart = JSON.parse(JSON.stringify(room.gameState)); // Copia profunda para referencia

      let precomputedPrizePath = null;
      if (gameType === 'parchis' && move.type === 'move_prize_piece') {
          const prizeDistance = turnData.prizeMoves || 0;
        
          // Validación de seguridad
          if (prizeDistance <= 0 || prizeDistance !== move.diceValue) {
              return socket.emit('ludoError', { message: 'Movimiento de premio inválido.' });
          }

          // Encontrar la ficha
          const playerPiecesList = room.gameState.pieces[playerColor] || [];
          const prizePiece = playerPiecesList.find(p => p.id === move.pieceId && p.state === 'active');
          if (!prizePiece) {
              return socket.emit('ludoError', { message: 'Ficha de premio inválida.' });
          }

          // Calcular ruta
          precomputedPrizePath = ludoCalculatePath(playerColor, prizePiece.position, prizeDistance, boardRules, room.gameState.pieces, gameType);
          if (precomputedPrizePath.finalPosition === null) {
              return socket.emit('ludoError', { message: 'Ruta de premio inválida.' });
          }

          // TRANSFORMACIÓN DEL MOVIMIENTO
          move.originalType = 'move_prize_piece';
          move.type = 'move_active_piece';
          move.prizeMove = true;
          move.prizeDistance = prizeDistance;

          // ¡CRUCIAL! Guardamos los dados restantes antes de sobrescribirlos
          move.savedRemainingDice = Array.isArray(turnData.moves) ? [...turnData.moves] : [];
          console.log(`[Parchís] Ejecutando PREMIO de ${prizeDistance}. Dados guardados para después: [${move.savedRemainingDice.join(', ')}]`);

          // Sobrescribimos para ejecutar el premio
          turnData.moves = [prizeDistance];
        
          // Simulamos que este era el único movimiento posible
          turnData.possibleMoves = [{
              type: 'move_prize_piece',
              pieceId: move.pieceId,
              diceValue: prizeDistance,
              targetPosition: precomputedPrizePath.finalPosition,
              prizeMove: true
          }];
      }

      // --- VALIDAR EL MOVIMIENTO ---
      // ▼▼▼ BLOQUE COMENTADO (SALIDA AUTOMÁTICA CON DOBLES) ▼▼▼
      /*
      let isValidMove = false;
    
      if (move.type === 'move_from_base') {
          // 1. ¿El jugador tiene permitido este *tipo* de movimiento?
          isValidMove = turnData.possibleMoves.some(p => p.type === 'move_from_base');
        
          // 2. ¿La ficha que quiere mover ('move.pieceId') está en su base?
          const pieceToMove = room.gameState.pieces[playerColor].find(p => p.id === move.pieceId);
        
          if (isValidMove && pieceToMove && pieceToMove.state === 'base') {
              console.log(`[${roomId}] ${playerColor} saca la ficha ${move.pieceId} de la base.`);
            
              // --- EJECUTAR MOVIMIENTO ---
              // 1. Mover ficha
              const startPosition = room.gameState.board.start[playerColor];
              pieceToMove.state = 'active';
              pieceToMove.position = startPosition;
            
              // TODO: Implementar regla de "matar al salir"
            
              // 2. Actualizar estado del turno
              // Según tus reglas, sacar con doble permite volver a tirar
              turnData.canRoll = true; // ¡Vuelve a tirar!
              turnData.canRollAgain = false; // Ya se usó el beneficio del doble
              turnData.moves = []; // Se consumen los dados
              turnData.possibleMoves = [];

              // 3. Transmitir el estado actualizado a TODOS
              io.to(roomId).emit('ludoGameStateUpdated', {
                  newGameState: room.gameState,
                  moveInfo: { ...move, playerColor, newPosition: startPosition }
              });
            
          } else {
              return socket.emit('ludoError', { message: 'Movimiento inválido.' });
          }
      }
      */
      // ▲▲▲ FIN DEL BLOQUE COMENTADO ▲▲▲
    
      // ▼▼▼ AÑADE ESTE BLOQUE 'IF' ▼▼▼
      if (move.type === 'move_active_piece') {
          const { pieceId, diceValue } = move;
          const isCurrentPrizeMove = Boolean(move.prizeMove);
          const actionLabel = isCurrentPrizeMove ? 'Premio' : 'Mover';
          // ▼▼▼ LOG DE INICIO ▼▼▼
          console.log(`[SERVER MOVE INIT] Recibido: ${actionLabel} ${pieceId} con ${diceValue}. Dados disponibles ANTES: ${turnData.moves.join(', ')}`);
          // ▲▲▲ FIN LOG ▲▲▲
          console.log(`[${roomId}] ${playerColor} quiere ${isCurrentPrizeMove ? 'usar premio sobre' : 'mover'} ${pieceId} con valor ${diceValue}`);

          // 1. Encuentra el movimiento específico en los posibles
          const validMove = turnData.possibleMoves.find(
              p => (p.type === 'move_active_piece' || p.type === 'move_prize_piece') && p.pieceId === pieceId && p.diceValue === diceValue
          );
        
          // 2. Encuentra la ficha a mover
          const playerPiecesList = room.gameState.pieces[playerColor] || [];
          const pieceToMove = playerPiecesList.find(p => p.id === pieceId);

          // 3. Verifica si el movimiento (dado o suma) es válido con los dados disponibles
          let remainingDice = Array.isArray(turnData.moves) ? [...turnData.moves] : []; // COPIA SEGURA
          let isValidDiceChoice = false;

          if (isCurrentPrizeMove) {
              remainingDice = Array.isArray(move.savedRemainingDice) ? [...move.savedRemainingDice] : [];
              isValidDiceChoice = true;
          } else {
              // Comprobación A: ¿Es un movimiento de SUMA?
              if (remainingDice.length === 2 && (remainingDice[0] + remainingDice[1] === diceValue)) {
                  remainingDice = []; // Se consumen ambos dados
                  isValidDiceChoice = true;
                  console.log(`[${roomId}] Validado como SUMA (${diceValue}). Dados restantes: []`);
              }
              // Comprobación B: ¿Es un movimiento de dado INDIVIDUAL?
              else {
                  const dieIndex = remainingDice.indexOf(diceValue);
                  if (dieIndex > -1) {
                      remainingDice.splice(dieIndex, 1); // Quitar solo ese dado
                      isValidDiceChoice = true;
                      console.log(`[${roomId}] Validado como dado INDIVIDUAL (${diceValue}). Dados restantes: [${remainingDice.join(', ')}]`);
                  }
              }
          }

          // Si ninguna comprobación fue exitosa, el movimiento es inválido
          if (!isValidDiceChoice) {
               console.warn(`[${roomId}] Movimiento inválido: ${diceValue} no es jugable con los dados [${turnData.moves.join(', ')}].`);
               // Envía un error específico para que el cliente sepa qué falló
               return socket.emit('ludoError', { message: `Movimiento inválido (dado ${diceValue} no disponible o suma incorrecta).` });
          }
          // Si llegamos aquí, 'isValidDiceChoice' es true y 'remainingDice' está actualizado
          // (ya no necesitamos la variable 'usedSum')

          // ▼▼▼ LOG DESPUÉS DE VALIDAR DADO ▼▼▼
          console.log(`[SERVER MOVE EXEC] Movimiento ${diceValue} validado. Dados restantes DESPUÉS: ${remainingDice.join(', ')}`);
          // ▲▲▲ FIN LOG ▲▲▲

          // --- Lógica de Parchís: Salida automática con 5 restante ---
          if (gameType === 'parchis' &&
              remainingDice.length === 1 &&
              remainingDice[0] === 5 &&
              !isCurrentPrizeMove) {
              const piecesInBaseAuto = playerPiecesList.filter(p => p.state === 'base').length;

              if (piecesInBaseAuto > 0) {
                  const startPosAuto = boardRules.start[playerColor];
                  const piecesOnStartAuto = playerPiecesList.filter(p => p.state === 'active' && p.position === startPosAuto).length;

                  if (piecesOnStartAuto >= 2) {
                      console.log(`[Parchís Auto-Exit] Jugador ${playerColor} tiene un bloqueo en la salida (${piecesOnStartAuto} fichas) y un 5 restante.`);

                      const pieceToExit = playerPiecesList.find(p => p.state === 'base');
                      if (pieceToExit) {
                          let killOnExit = false;
                          for (const oppColor in room.gameState.pieces) {
                              if (oppColor === playerColor) continue;
                              room.gameState.pieces[oppColor].forEach(oppPiece => {
                                  if (oppPiece.state === 'active' && oppPiece.position === startPosAuto) {
                                      oppPiece.state = 'base';
                                      oppPiece.position = -1;
                                      killOnExit = true;
                                      console.log(`[Parchís Auto-Exit] ¡Matanza! ${pieceToExit.id} comió a ${oppPiece.id} en ${startPosAuto}`);
                                  }
                              });
                          }

                          pieceToExit.state = 'active';
                          pieceToExit.position = startPosAuto;
                          remainingDice = [];

                          if (killOnExit) {
                              turnData.prizeMoves = (turnData.prizeMoves || 0) + 20;
                          }

                          setTimeout(() => {
                              try {
                                  const currentRoom = ludoRooms[roomId];
                                  if (currentRoom) {
                                      io.to(roomId).emit('ludoGameStateUpdated', {
                                          newGameState: currentRoom.gameState,
                                          moveInfo: {
                                              type: 'parchis_auto_exit',
                                              playerColor,
                                              piecesMoved: [pieceToExit.id],
                                              startPosition: startPosAuto
                                          }
                                      });
                                      console.log(`[Parchís Auto-Exit] Ficha ${pieceToExit.id} ha salido.`);
                                  }
                              } catch (e) {
                                  console.error("Error en Timeout Move Piece:", e);
                              }
                          }, 2000);
                      }
                  }
              }
          }


          if (validMove && pieceToMove && pieceToMove.state === 'active') {
               // ▼▼▼ INICIO: VERIFICACIÓN "MATAR ES OBLIGATORIO" (LÓGICA MEJORADA v5 - SOLO LUDO) ▼▼▼
              if (gameType !== 'parchis') {
                  const initialPossibleMoves = gameStateRefForTurnStart.turn.possibleMoves || [];
                  const potentialKillMovesAtTurnStart = initialPossibleMoves.filter(move =>
                      move.type === 'move_active_piece' && ludoIsKillMove(move.targetPosition, playerColor, gameStateRefForTurnStart.pieces, room.gameState.board)
                  );
                
                  const mustKill = potentialKillMovesAtTurnStart.length > 0;
                  const chosenMoveIsKill = ludoIsKillMove(validMove.targetPosition, playerColor, room.gameState.pieces, room.gameState.board);

                  if (mustKill && !chosenMoveIsKill) {
                      console.log(`[${roomId}] Movimiento no matador (${pieceId} con ${diceValue}). Había matanza(s) posible(s) al inicio.`);

                      const targetKillPositions = [...new Set(potentialKillMovesAtTurnStart.map(m => m.targetPosition))];
                    
                      let killStillPossible = false;
                      const activePiecesNow = playerPiecesList.filter(p => p.state === 'active');

                      if (remainingDice.length > 0) {
                          console.log(`[${roomId}] Verificando si aún se puede matar con dados restantes: [${remainingDice.join(', ')}] hacia [${targetKillPositions.join(', ')}]`);

                          // ▼▼▼ LÓGICA CORREGIDA: Verificar si la ficha que se movió ES la que podía matar ▼▼▼
                          const originalKillingPiece = potentialKillMovesAtTurnStart[0];
                          const originalKillingPieceCurrent = activePiecesNow.find(p => p.id === originalKillingPiece.pieceId);
                          
                          // CASO 1: La ficha que se movió ES la misma que podía matar
                          if (originalKillingPieceCurrent && originalKillingPieceCurrent.id === pieceId) {
                              // Verificar si con el dado restante se puede matar desde la NUEVA posición (después del movimiento)
                              const newPositionAfterMove = validMove.targetPosition;
                              for (const die of remainingDice) {
                                  const simulatedPath = ludoCalculatePath(playerColor, newPositionAfterMove, die, boardRules, room.gameState.pieces, gameType);
                                  if (simulatedPath.finalPosition !== null && targetKillPositions.includes(simulatedPath.finalPosition)) {
                                      killStillPossible = true;
                                      console.log(`[${roomId}] ✅ AÚN ES POSIBLE MATAR: ${pieceId} (en nueva posición ${newPositionAfterMove}) puede llegar a ${simulatedPath.finalPosition} con ${die}.`);
                                      break;
                                  }
                              }
                          }
                          // CASO 2: La ficha que se movió NO es la que podía matar
                          else if (originalKillingPieceCurrent && originalKillingPieceCurrent.id !== pieceId) {
                              // Verificar si con el dado restante se puede matar usando la ficha original (que no se movió)
                              for (const die of remainingDice) {
                                  const simulatedPath = ludoCalculatePath(playerColor, originalKillingPieceCurrent.position, die, boardRules, room.gameState.pieces, gameType);
                                  if (simulatedPath.finalPosition !== null && targetKillPositions.includes(simulatedPath.finalPosition)) {
                                      killStillPossible = true;
                                      console.log(`[${roomId}] ✅ AÚN ES POSIBLE MATAR: ${originalKillingPieceCurrent.id} (en ${originalKillingPieceCurrent.position}) puede llegar a ${simulatedPath.finalPosition} con ${die}.`);
                                      break;
                                  }
                              }
                          }
                          // ▲▲▲ FIN LÓGICA CORREGIDA ▲▲▲

                          // Verificar con otras fichas si aún no se puede matar
                          if (!killStillPossible) {
                          for (const piece of activePiecesNow) {
                              if (piece.id === pieceId) {
                                  console.log(`[${roomId}] Regla 1: Excluyendo ${piece.id} de verificación de matanza.`);
                                  continue;
                              }

                              for (const die of remainingDice) {
                                  const simulatedPath = ludoCalculatePath(playerColor, piece.position, die, boardRules, room.gameState.pieces, gameType);
                                  if (simulatedPath.finalPosition !== null && targetKillPositions.includes(simulatedPath.finalPosition)) {
                                      killStillPossible = true;
                                      console.log(`[${roomId}] ✅ AÚN ES POSIBLE MATAR: ${piece.id} (en ${piece.position}) puede llegar a ${simulatedPath.finalPosition} con ${die}.`);
                                      break;
                                  }
                              }
                              if (killStillPossible) break;

                              if (remainingDice.length === 2 && !killStillPossible) {
                                  const sumDie = remainingDice[0] + remainingDice[1];
                                  const simulatedSumPath = ludoCalculatePath(playerColor, piece.position, sumDie, boardRules, room.gameState.pieces, gameType);
                                  if (simulatedSumPath.finalPosition !== null && targetKillPositions.includes(simulatedSumPath.finalPosition)) {
                                      killStillPossible = true;
                                      console.log(`[${roomId}] ✅ AÚN ES POSIBLE MATAR: ${piece.id} (en ${piece.position}) puede llegar a ${simulatedSumPath.finalPosition} con la suma ${sumDie}.`);
                                      break;
                                  }
                              }
                              if (killStillPossible) break;
                              }
                          }
                      } else {
                          console.log(`[${roomId}] No quedan dados y no se realizó la matanza obligatoria.`);
                      }

                      if (!killStillPossible) {
                          console.log(`[${roomId}] ❌ ¡FALTA! Ya no es posible realizar ninguna matanza obligatoria.`);

                          const penalizedPieceData = potentialKillMovesAtTurnStart[0];
                          const penalizedPieceCurrentState = room.gameState.pieces[playerColor].find(p => p.id === penalizedPieceData.pieceId);

                          if (penalizedPieceCurrentState && penalizedPieceCurrentState.state === 'active') {
                              let targetPieceId = null;
                              for (const oppColor in gameStateRefForTurnStart.pieces) {
                                  if (oppColor === playerColor) continue;
                                  const oppPiece = gameStateRefForTurnStart.pieces[oppColor].find(p => 
                                      p.state === 'active' && p.position === penalizedPieceData.targetPosition
                                  );
                                  if (oppPiece) { 
                                      targetPieceId = oppPiece.id; 
                                      break; 
                                  }
                              }

                              io.to(roomId).emit('playSound', 'fault');
                              io.to(roomId).emit('ludoFoulPenalty', {
                                  penalizedPieceId: penalizedPieceCurrentState.id,
                                  killingPieceId: penalizedPieceCurrentState.id,
                                  playerColor: playerColor,
                                  killingPiecePosition: penalizedPieceCurrentState.position,
                                  targetKillPosition: penalizedPieceData.targetPosition,
                                  targetPieceId: targetPieceId
                              });

                              penalizedPieceCurrentState.state = 'base';
                              penalizedPieceCurrentState.position = -1;
                              console.log(`[${roomId}] Ficha ${penalizedPieceCurrentState.id} penalizada y enviada a la base.`);
                            
                              room.gameState.turn.isMoving = false;
                          } else {
                              console.warn(`[${roomId}] Se detectó falta, pero no se encontró la ficha a penalizar (${penalizedPieceData?.pieceId}).`);
                          }
                      } else {
                          console.log(`[${roomId}] ✅ No se penaliza. Matanza obligatoria todavía posible con dados restantes.`);
                      }
                  }
              }
               // ▲▲▲ FIN: VERIFICACIÓN "MATAR ES OBLIGATORIO" (LÓGICA MEJORADA v5 - SOLO LUDO) ▲▲▲

               // ▼▼▼ Esta línea ya existe (aprox. 1053) ▼▼▼
              const startPosition = pieceToMove.position; // Guarda la posición ANTES de mover
               room.gameState.turn.isMoving = true; // ¡BLOQUEA EL ESTADO!

               // ▼▼▼ AÑADIR ESTE BLOQUE ▼▼▼
               // -----------------------------------------------------------------
               // MANEJO DE MOVIMIENTO POST-ROTURA DE BLOQUEO (PARCHÍS)
               // -----------------------------------------------------------------
               if (gameType === 'parchis' && turnData.isForcedBlockadeBreak) {
                  console.log(`[Parchís] Jugador completó la rotura de bloqueo forzada.`);
                  // 1. Limpiar flags
                  turnData.isForcedBlockadeBreak = false;

                  // 2. Guardar la posición de la ficha que NO se puede mover
                  turnData.lastBreakdownStartPos = startPosition;

                  // 3. Restaurar el segundo dado del doble
                  const fallbackDie = Array.isArray(turnData.dice) && turnData.dice.length > 1
                      ? turnData.dice[1]
                      : (Array.isArray(turnData.dice) && turnData.dice.length > 0 ? turnData.dice[0] : undefined);
                  turnData.moves = (fallbackDie !== undefined) ? [fallbackDie] : [];
                  remainingDice = [...turnData.moves];

                  // 4. Bono de doble sigue pendiente
                  turnData.canRollAgain = true;

                  // 5. Recalcular movimientos con el segundo dado, excluyendo la ficha en 'startPosition'
                  const remainingActivePieces = playerPiecesList.filter(p => 
                      p.state === 'active' && p.position !== startPosition
                  );
                  const dieValueForced = turnData.moves[0];
                  const sumValueForced = (dieValueForced !== undefined) ? dieValueForced + dieValueForced : null; // Para el caso 6-6 -> 12

                  turnData.possibleMoves = [];

                  if (dieValueForced !== undefined) {
                      remainingActivePieces.forEach(piece => {
                          const { finalPosition: posDie } = ludoCalculatePath(playerColor, piece.position, dieValueForced, boardRules, room.gameState.pieces, 'parchis');
                          if (posDie !== null) {
                              turnData.possibleMoves.push({
                                  type: 'move_active_piece', pieceId: piece.id, diceValue: dieValueForced, targetPosition: posDie
                              });
                          }
                          if (sumValueForced !== null) {
                              const { finalPosition: posSum } = ludoCalculatePath(playerColor, piece.position, sumValueForced, boardRules, room.gameState.pieces, 'parchis');
                              if (posSum !== null) {
                                  turnData.possibleMoves.push({
                                      type: 'move_active_piece', pieceId: piece.id, diceValue: sumValueForced, targetPosition: posSum
                                  });
                              }
                          }
                      });
                  }

                  console.log(`[Parchís] Dados restantes: [${turnData.moves.join(', ')}]. Movimientos posibles: ${turnData.possibleMoves.length}`);

                  // Si no hay NADA que mover con el segundo dado, se pasa directo al bono de "roll again"
                  if (turnData.possibleMoves.length === 0 || dieValueForced === undefined) {
                      console.log(`[Parchís] No hay movimientos para el 2º dado. Pasando a 'Tirar de Nuevo'.`);
                      turnData.canRoll = true;
                      turnData.canRollAgain = false; // El bono se consume ahora
                      turnData.moves = [];
                      turnData.lastBreakdownStartPos = null; // Limpiar
                      remainingDice = [];
                  }
               }
               // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲
               // ▲▲▲ FIN ▲▲▲

               console.log(`[${roomId}] Movimiento válido: ${pieceId} a ${validMove.targetPosition}`);
            
              // ▼▼▼ INICIO: MODIFICACIÓN USO calculatePath ▼▼▼
              // Calcula la ruta y la posición final USANDO LA NUEVA FUNCIÓN
              const pathResult = precomputedPrizePath && isCurrentPrizeMove
                  ? precomputedPrizePath
                  : ludoCalculatePath(playerColor, pieceToMove.position, diceValue, boardRules, room.gameState.pieces, gameType);
              const { finalPosition, path: movePath } = pathResult;

              // Comprobación adicional: ¿El movimiento calculado coincide con el esperado?
              if (finalPosition === null || finalPosition !== validMove.targetPosition) {
                   console.error(`[${roomId}] DISCREPANCIA: Movimiento validado a ${validMove.targetPosition}, pero calculatePath dio ${finalPosition}. Move:`, move);
                   // Por ahora, confiamos en validMove.targetPosition pero reportamos el error
              }

              console.log(`[${roomId}] Movimiento válido: ${pieceId} de ${pieceToMove.position} a ${validMove.targetPosition}. Ruta: [${movePath.join(', ')}]`);
              // ▲▲▲ FIN: MODIFICACIÓN USO calculatePath ▲▲▲
            
              // --- EJECUTAR MOVIMIENTO ---
              // a. Mover ficha
              pieceToMove.position = validMove.targetPosition;
              if (isCurrentPrizeMove) {
                  turnData.prizeMoves = 0;
              }
              turnData.lastMovedPieceId = pieceId;

              // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO ▼▼▼
              const landingPosition = validMove.targetPosition;
              const allSafeSquares = [
                  ...room.gameState.board.safe, 
                  ...room.gameState.board.startSafe
              ];
              const isSafeSquare = allSafeSquares.includes(landingPosition);
              let killOccurred = false; // Bandera para el turno extra
              let finalSound = null; // Sonido a reproducir después de la animación

              // Si la casilla NO es segura, comprobar si hay muertes
              if (!isSafeSquare) {
                  for (const color in room.gameState.pieces) {
                      if (color === playerColor) continue; // No matarnos a nosotros mismos

                      room.gameState.pieces[color].forEach(opponentPiece => {
                          // Si un oponente está en la misma casilla...
                          if (opponentPiece.state === 'active' && opponentPiece.position === landingPosition) {
                            
                              // ...lo matamos
                              opponentPiece.state = 'base';
                              opponentPiece.position = -1;
                              killOccurred = true;
                              finalSound = 'gunshot'; // Sonido cuando se mata una ficha (se reproducirá después de la animación)
                            
                              console.log(`[${roomId}] ¡MATANZA! ${pieceId} (${playerColor}) ha comido a ${opponentPiece.id} en ${landingPosition}`);

                              if (gameType === 'parchis') {
                                  // PARCHÍS: Sumar 20 al bono
                                  turnData.prizeMoves = (turnData.prizeMoves || 0) + 20;
                                
                                  // ¡CORRECCIÓN! NO tocar canRollAgain. 
                                  // turnData.canRollAgain se mantiene como estaba (true si fue doble, false si no).
                              } else {
                                  // LUDO TRADICIONAL: Matar da tiro extra
                                  turnData.canRollAgain = true; 
                              }
                          }
                      });
                  }
              }
              // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲
            
              // Obtener la meta y zona de meta para usar en detección de bloqueos y verificación de meta
              const goalCell = room.gameState.board.goal[playerColor];
            
              // ▼▼▼ DETECCIÓN DE BLOQUEO (PARCHÍS) ▼▼▼
              // Verificar si se formó un bloqueo después de mover la ficha
              if (gameType === 'parchis' && !finalSound) { // Solo si no hubo muerte
                  // Excluir la zona de meta y la meta final de la detección de bloqueos
                  const homeStretch = room.gameState.board.home_stretch[playerColor] || [];
                  const isInHomeStretch = homeStretch.includes(landingPosition);
                  const isGoal = (landingPosition === goalCell);
                  
                  // Solo detectar bloqueos si NO está en la zona de meta ni en la meta final
                  if (!isInHomeStretch && !isGoal) {
                      let totalPiecesOnLanding = 0;
                      for (const color in room.gameState.pieces) {
                          const piecesOnPosition = room.gameState.pieces[color].filter(
                              p => p.state === 'active' && p.position === landingPosition
                          );
                          totalPiecesOnLanding += piecesOnPosition.length;
                      }
                      
                      // Si hay 2 o más fichas en la posición de aterrizaje, se formó un bloqueo
                      if (totalPiecesOnLanding >= 2) {
                          finalSound = 'bloqueo'; // Sonido cuando se forma un bloqueo (se reproducirá después de la animación)
                          console.log(`[${roomId}] ¡BLOQUEO FORMADO! ${totalPiecesOnLanding} fichas en posición ${landingPosition}`);
                      }
                  }
              }
              // ▲▲▲ FIN DETECCIÓN DE BLOQUEO ▲▲▲
            
              // ▼▼▼ INICIO DE LA CORRECCIÓN (LÓGICA DE VICTORIA) ▼▼▼
            
              // b. ¿La ficha llegó a la meta?
              let goalOccurred = false; // <-- AÑADE ESTA LÍNEA
              if (pieceToMove.position === goalCell) {
                  goalOccurred = true; // <-- AÑADE ESTA LÍNEA
                  if (!finalSound) { // Solo si no hubo muerte o bloqueo
                      finalSound = 'add'; // Sonido cuando una ficha entra a la meta (se reproducirá después de la animación)
                  }
                  if (gameType === 'parchis') {
                      turnData.prizeMoves = (turnData.prizeMoves || 0) + 10;
                      turnData.canRollAgain = turnData.canRollAgain || false;
                  } else {
                      turnData.canRollAgain = true; // Guardar el bono en el estado del turno
                  }
                  console.log(`[${roomId}] ¡La ficha ${pieceToMove.id} ha llegado a la meta!`);
                
                  // c. ¿Ha ganado el jugador?
                  if (ludoCheckWinCondition(room, playerColor)) {
                      console.log(`[${roomId}] ¡¡¡VICTORIA PARA ${playerColor}!!!`);
                    
                      // 1. Marcar el estado del juego como terminado
                      room.state = 'post-game'; // Nuevo estado
                    
                      // 2. Notificar a todos
                      const winnerSeat = room.seats.find(s => s && s.color === playerColor);
                      const winnerName = winnerSeat ? winnerSeat.playerName : playerColor;
                    
                      // --- INICIO: CALCULAR DETALLES PARA EL MODAL ---
                      const totalPot = room.gameState.pot;
                      const commission = totalPot * 0.10; // 10% de comisión
                      const finalWinnings = totalPot - commission;

                      // Guardar comisión en el log de administración (solo una vez por partida)
                      if (!room.commissionSaved) {
                          const commissionInCOP = convertCurrency(commission, room.settings.betCurrency || 'USD', 'COP', exchangeRates);
                          await saveCommission(commissionInCOP, 'COP');
                          room.commissionSaved = true; // Marcar que ya se guardó la comisión
                      }

                      const roomCurrency = room.settings.betCurrency || 'USD';
                      const gameType = room.settings.gameType || 'ludo';
                      const isGroups = gameType === 'parchis' && room.settings.parchisMode === '4-groups';

                      const winners = [];
                      if (winnerSeat) {
                          winners.push(winnerSeat);
                      }

                      if (isGroups && winnerSeat) {
                          const seatIndex = room.seats.indexOf(winnerSeat);
                          const partnerSeatIndex = (seatIndex + 2) % 4;
                          const partnerSeat = room.seats[partnerSeatIndex];
                          if (partnerSeat) {
                              winners.push(partnerSeat);
                          }
                      }

                      const winningsPerPlayer = winners.length > 0 ? finalWinnings / winners.length : 0;

                      const winningPlayersPayload = [];

                      for (const seatInfo of winners) {
                          if (!seatInfo) continue;
                          // ▼▼▼ CORRECCIÓN CRÍTICA: Obtener userInfo desde users, BD o inMemoryUsers ▼▼▼
                          const winnerUsername = seatInfo.userId ? seatInfo.userId.replace('user_', '') : null;
                          let winnerInfo = seatInfo.userId ? users[seatInfo.userId] : null;
                          
                          // Si no está en users, intentar obtenerlo de la BD o inMemoryUsers
                          if (!winnerInfo && seatInfo.userId) {
                              try {
                                  if (DISABLE_DB) {
                                      const userFromMemory = inMemoryUsers.get(winnerUsername);
                                      if (userFromMemory) {
                                          winnerInfo = {
                                              credits: parseFloat(userFromMemory.credits || 0),
                                              currency: userFromMemory.currency || 'EUR'
                                          };
                                          // Guardar en users para futuras referencias
                                          users[seatInfo.userId] = winnerInfo;
                                      }
                                  } else {
                                      const userData = await getUserByUsername(winnerUsername);
                                      if (userData) {
                                          winnerInfo = userData;
                                          // Guardar en users para futuras referencias
                                          users[seatInfo.userId] = winnerInfo;
                                      }
                                  }
                              } catch (error) {
                                  console.error(`[${roomId}] Error obteniendo datos de usuario para pago:`, error);
                              }
                          }

                          if (winnerInfo) {
                              const winningsInUserCurrency = convertCurrency(winningsPerPlayer, roomCurrency, winnerInfo.currency, exchangeRates);
                              winnerInfo.credits += winningsInUserCurrency;
                              
                              // Actualizar en BD o inMemoryUsers
                              await updateUserCredits(seatInfo.userId, winnerInfo.credits, winnerInfo.currency);

                              console.log(`[${roomId}] PAGO REALIZADO (Victoria): ${winnerUsername} recibe ${winningsPerPlayer.toFixed(2)} ${roomCurrency} (Equivalente a ${winningsInUserCurrency.toFixed(2)} ${winnerInfo.currency}).`);
                              console.log(`[${roomId}] Saldo anterior: ${(winnerInfo.credits - winningsInUserCurrency).toFixed(2)} ${winnerInfo.currency}. Saldo nuevo: ${winnerInfo.credits.toFixed(2)} ${winnerInfo.currency}.`);

                              const winnerSocket = io.sockets.sockets.get(seatInfo.playerId);
                              if (winnerSocket) {
                                  winnerSocket.emit('userStateUpdated', winnerInfo);
                              }

                              winningPlayersPayload.push({
                                  playerId: seatInfo.playerId,
                                  userId: seatInfo.userId,
                                  playerName: seatInfo.playerName,
                                  color: seatInfo.color,
                                  winningsRoomCurrency: winningsPerPlayer,
                                  winningsUserCurrency: winningsInUserCurrency,
                                  userCurrency: winnerInfo.currency
                              });
                          } else {
                              console.warn(`[${roomId}] PAGO FALLIDO (Victoria): No se encontró userInfo para ${winnerUsername} (ID: ${seatInfo.userId}).`);
                          }
                          // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
                      }
                      const playersWhoPlayed = room.gameState.playersAtStart || [winnerName];
                      const winnerNamesArray = winningPlayersPayload.length > 0
                          ? winningPlayersPayload.map(p => p.playerName || p.userId || 'Jugador')
                          : [winnerName];
                      const winnerDisplayName = winnerNamesArray.join(' & ');
                        
                      // ▼▼▼ INICIALIZAR SISTEMA DE REVANCHA ▼▼▼
                      room.rematchData = {
                          winnerId: winnerSeat ? winnerSeat.playerId : null,
                          winnerName: winnerDisplayName,
                          winnerColor: playerColor,
                          confirmedPlayers: [],
                          canStart: false,
                          expectedPlayers: playersWhoPlayed.length // Guarda cuántos jugaron
                      };
                      // --- FIN: CALCULAR DETALLES ---

                      // ▼▼▼ PRIMERO ENVIAR EL MOVIMIENTO PARA QUE SE ANIME ▼▼▼
                      // Calcular el tiempo de animación basado en la distancia recorrida
                      const animationTime = Math.max(2000, movePath.length * 150); // Mínimo 2 segundos, 150ms por casilla
                      console.log(`[${roomId}] Enviando ludoGameStateUpdated primero (animación: ${animationTime}ms), luego ludoGameOver después de ${animationTime + 500}ms`);
                    
                      // Enviar el movimiento primero para que se anime
                      io.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState,
                          moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                      });
                      room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                    
                      // ▼▼▼ LUEGO ENVIAR EL MODAL DE VICTORIA DESPUÉS DE LA ANIMACIÓN ▼▼▼
                      setTimeout(() => {
                          // Verificar que la sala todavía existe
                          if (!ludoRooms[roomId]) {
                              console.warn(`[${roomId}] Sala eliminada antes de enviar ludoGameOver`);
                              return;
                          }
                        
                          io.to(roomId).emit('playSound', 'victory');
                          io.to(roomId).emit('ludoGameOver', {
                              winnerName: winnerDisplayName,
                              winnerColor: playerColor,
                              winnerAvatar: winnerSeat ? winnerSeat.avatar : '',
                              // ▼▼▼ DATOS AÑADIDOS ▼▼▼
                              playersWhoPlayed: playersWhoPlayed,
                              totalPot: totalPot,
                              commission: commission,
                              finalWinnings: finalWinnings,
                              winningPlayers: winningPlayersPayload,
                              // ▲▲▲ FIN DATOS AÑADIDOS ▲▲▲
                              rematchData: room.rematchData // Mantenemos esto
                          });
                        
                          // Notifica a TODOS en el lobby que el estado de esta sala cambió a 'post-game'
                          broadcastLudoRoomListUpdate(io);
                      }, animationTime + 500); // Esperar la animación + 500ms extra de seguridad
                    
                      room.allowRematchConfirmation = true; // Previene limpieza temporalmente
                    
                      // Detenemos la ejecución del movimiento (no se pasa turno)
                      return;
                  }
              }
              // ▲▲▲ FIN DE LA CORRECCIÓN (LÓGICA DE VICTORIA) ▲▲▲
            
              // d. Actualizar estado del turno
              turnData.moves = remainingDice; // Actualiza los dados restantes
              // ▼▼▼ LOG DESPUÉS DE ACTUALIZAR ▼▼▼
              console.log(`[SERVER MOVE STORE] Actualizando turnData.moves a: ${turnData.moves.join(', ')}`);
              // ▲▲▲ FIN LOG ▲▲▲
              turnData.possibleMoves = []; // Limpia movimientos, se recalcularán si es necesario
              turnData.canRoll = false; // Por defecto no puede tirar de nuevo

              // ▼▼▼ INICIO DE LA MODIFICACIÓN (PRIORIZAR PREMIO PARCHÍS) ▼▼▼
              if (gameType === 'parchis' && (turnData.prizeMoves || 0) > 0) {
                  const prizeDistance = turnData.prizeMoves;
                  console.log(`[${roomId}] Parchís: Prioritizing Prize Move (${prizeDistance}). Dados en espera: [${turnData.moves.join(', ')}]`);

                  const activePiecesForPrize = playerPiecesList.filter(p => p.state === 'active');
                  activePiecesForPrize.forEach(piece => {
                      const result = ludoCalculatePath(playerColor, piece.position, prizeDistance, boardRules, room.gameState.pieces, gameType);
                      if (result.finalPosition !== null) {
                          turnData.possibleMoves.push({
                              type: 'move_prize_piece',
                              pieceId: piece.id,
                              diceValue: prizeDistance,
                              targetPosition: result.finalPosition,
                              prizeMove: true
                          });
                      }
                  });

                  console.log(`[${roomId}] Movimientos de premio posibles:`, turnData.possibleMoves);

                  if (turnData.possibleMoves.length === 0) {
                      console.log(`[${roomId}] No hay movimientos posibles para el premio de ${prizeDistance}. Se pierde el premio.`);
                      turnData.prizeMoves = 0;
                  } else {
                      io.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState,
                          moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                      });
                      room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                      return;
                  }
              }
              // ▼▼▼ FIN DE LA MODIFICACIÓN ▼▼▼

              // c. ¿Quedan dados por mover? Recalcular movimientos posibles
              if (turnData.moves.length > 0) {
                   console.log(`[${roomId}] Queda dado ${turnData.moves[0]}. Recalculando...`);
                   const remainingDie = turnData.moves[0];

                   // ▼▼▼ INICIO DE LA LÓGICA (REGLA 1) ▼▼▼
                   // Filtra las piezas activas
                   let piecesToTest = playerPiecesList.filter(p => p.state === 'active');

                   // Si fue un KILL, excluimos la ficha que acaba de matar (pieceId)
                   if (killOccurred && gameType !== 'parchis') {
                       console.log(`[${roomId}] Regla 1: Fue un KILL. Excluyendo ${pieceId} del próximo movimiento.`);
                       piecesToTest = piecesToTest.filter(p => p.id !== pieceId);
                   }
                   // ▼▼▼ BLOQUE REEMPLAZADO ▼▼▼
                   // Regla de Parchís: Si se rompió un bloqueo (auto o manual), no se puede mover la ficha que quedó.
                   if (gameType === 'parchis' && turnData.lastBreakdownStartPos !== null) {
                      console.log(`[Parchís] (2º dado) Excluyendo fichas en la casilla original ${turnData.lastBreakdownStartPos}.`);
                      // Excluimos todas las fichas que sigan en la posición de inicio del movimiento
                      piecesToTest = piecesToTest.filter(p => p.position !== turnData.lastBreakdownStartPos);
                      // Limpiamos la bandera para que no afecte al siguiente turno (el del bono)
                      turnData.lastBreakdownStartPos = null;
                   }
                   // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲
                   // ▲▲▲ FIN DE LA LÓGICA (REGLA 1) ▲▲▲

                   // Iterar SOLO sobre las piezas válidas
                   piecesToTest.forEach(piece => {
                        const result = ludoCalculatePath(playerColor, piece.position, remainingDie, boardRules, room.gameState.pieces, gameType);
                        if (result.finalPosition !== null) {
                             turnData.possibleMoves.push({
                                  type: 'move_active_piece', pieceId: piece.id, diceValue: remainingDie, targetPosition: result.finalPosition
                             });
                        }
                   });
                   console.log(`[${roomId}] Nuevos movimientos posibles:`, turnData.possibleMoves);

                   // Si no hay movimientos posibles con el dado restante (incluso después de aplicar la Regla 1)
                   if (turnData.possibleMoves.length === 0) {
                        // ▼▼▼ INICIO DE LA LÓGICA CORREGIDA ▼▼▼
                        // ¿Había un bono pendiente (doble, kill, goal)?
                        if (turnData.canRollAgain) {
                          console.log(`[${roomId}] No hay movimientos para dado ${turnData.moves[0]}, PERO hay bono guardado. Permitiendo tirar de nuevo.`);
                          turnData.canRoll = true;     // Permitir tirar
                          turnData.canRollAgain = false; // Bono consumido
                          turnData.moves = [];         // Limpiar dado no jugable

                          // Emitir estado actualizado ANTES de retornar
                          io.to(roomId).emit('ludoGameStateUpdated', {
                               newGameState: room.gameState,
                               moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                          });
                          room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                          return; // Salir, NO pasar turno

                     } else { // No había bono, y no hay movimientos -> Pasar turno (salvo premio pendiente)
                          const hasPendingPrize = (gameType === 'parchis' && (turnData.prizeMoves || 0) > 0);
                          if (!hasPendingPrize) {
                              console.log(`[${roomId}] No hay movimientos para el dado restante ${turnData.moves[0]}. Pasando turno...`);
                              io.to(roomId).emit('ludoGameStateUpdated', {
                                  newGameState: room.gameState,
                                  moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                              });
                              room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                              setTimeout(() => ludoPassTurn(room, io), 1000); // 1s de retraso
                              return; // Salimos de la función
                          } else {
                              console.log(`[${roomId}] Premio pendiente tras dado sin movimiento. Manteniendo turno para ${playerName}.`);
                              io.to(roomId).emit('ludoGameStateUpdated', {
                                  newGameState: room.gameState,
                                  moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                              });
                              room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                              return;
                          }
                     }
                   }

                   // ▼▼▼ AÑADE ESTE BLOQUE 'ELSE' COMPLETO ▼▼▼
                   else {
                      // Hay movimientos posibles con el dado restante. Emitir estado.
                      console.log(`[SERVER MOVE EMIT] Quedan movimientos. Enviando ludoGameStateUpdated con newGameState.turn.moves: ${turnData.moves.join(', ')}`);
                      io.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState,
                          moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                      });
                      room.gameState.turn.isMoving = false; // ¡LIBERA EL BLOQUEO!
                      return; // ¡IMPORTANTE: Detener ejecución aquí!
                   }
                   // ▲▲▲ FIN DEL BLOQUE 'ELSE' A AÑADIR ▲▲▲

              } else {
                   // No quedan dados. Comprobar bonos (Matar > Meta > Doble)
                   let hasBonus = false;

                   // 1. ¿Ha matado a una ficha ESTE MOVIMIENTO? (Lógica de Ludo)
                   if (killOccurred && gameType !== 'parchis') {
                        console.log(`[${roomId}] Bono (Regla 3 - LUDO): ${playerName} ha comido una ficha. ¡Tira de nuevo!`);
                        turnData.canRoll = true;
                        turnData.canRollAgain = false; // El bono de matar consume cualquier bono de doble
                        hasBonus = true;
                   }
                   // 2. ¿Ha llegado a la meta ESTE MOVIMIENTO? (y no mató)
                   else if (goalOccurred && gameType !== 'parchis') {
                        console.log(`[${roomId}] Bono (Regla 4): ${playerName} ha metido una ficha a la meta. ¡Tira de nuevo!`);
                        turnData.canRoll = true;
                        turnData.canRollAgain = false; // El bono de meta consume cualquier bono de doble
                        hasBonus = true;
                   }
                   // 3. ¿Ganó un bono en un movimiento ANTERIOR (doble)?
                   else if (turnData.canRollAgain) {
                        console.log(`[${roomId}] Bono (Guardado): ${playerName} tiene un bono guardado (doble Parchís/Ludo). ¡Tira de nuevo!`);
                        turnData.canRoll = true;
                        turnData.canRollAgain = false; // Ya se usó el beneficio
                        hasBonus = true;
                   } 

                   // 4. Emitir el estado final y decidir si pasar turno

                   // Emitir el resultado del movimiento actual
                   console.log(`[SERVER MOVE EMIT] (Final) Enviando ludoGameStateUpdated con newGameState.turn.moves: ${turnData.moves.join(', ')}`);
                   io.to(roomId).emit('ludoGameStateUpdated', {
                        newGameState: room.gameState,
                        moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath, finalSound: finalSound }
                   });
                   room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO

                  const hasPendingPrize = (gameType === 'parchis' && (turnData.prizeMoves || 0) > 0);
                  // Si NO hay bono ni premio pendiente, pasar el turno
                  if (!hasBonus && !hasPendingPrize) {
                     console.log(`[${roomId}] ${playerName} usó todos los dados. Pasando turno...`);
                     setTimeout(() => ludoPassTurn(room, io), 2200); // 1s anim + 1s espera + 0.2s buffer
                  }

                   return; // ¡IMPORTANTE: Detener ejecución aquí!
              }

          } else {
               console.warn(`[${roomId}] Movimiento inválido rechazado:`, move);
               return socket.emit('ludoError', { message: 'Movimiento inválido.' });
          }
      }
      // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲
    
      } catch (error) {
        console.error("🔥 ERROR CRÍTICO EN ludoMovePiece:", error);
        socket.emit('ludoError', { message: 'Error interno al mover la ficha.' });
      }
    
    }); // ▲▲▲ FIN DEL LISTENER DE MOVIMIENTO ▲▲▲

    socket.on('sendLudoGameChat', (data) => {
      const { roomId, text, sender } = data;
      io.to(roomId).emit('gameChatUpdate', { sender, text, ts: Date.now() });
    });

    // ▼▼▼ HANDLER DUPLICADO ELIMINADO - SE USA EL HANDLER COMPLETO EN LÍNEA 7047 ▼▼▼
    // El handler en línea 7047 maneja tanto Ludo como La 51 correctamente
    // ▲▲▲ FIN DE ELIMINACIÓN DE HANDLER DUPLICADO ▲▲▲

    // ▼▼▼ SISTEMA DE REVANCHA ▼▼▼
    socket.on('confirmRematch', (data) => {
      const receivedRoomId = data?.roomId;
      console.log(`\n--- [REMATCH SERVER] Recibido 'confirmRematch' ---`);
      console.log(`  - Socket ID: ${socket.id}`);
      console.log(`  - Room ID recibido: ${receivedRoomId}`);
      console.log(`  - Salas existentes AHORA: [${Object.keys(ludoRooms).join(', ')}]`);
      console.log(`--- FIN LOG DETALLADO ---\n`);
    
      const { roomId } = data;
      const room = ludoRooms[roomId];
    
      if (!room || !room.rematchData) {
        console.error(`[REMATCH SERVER ERROR] Sala ${roomId} o rematchData no encontrado.`);
        return socket.emit('rematchError', { message: 'No hay revancha disponible.' });
      }
    
      let playerName = null;
      let userIdForLookup = null;
      const playerSeat = room.seats.find(s => s && s.playerId === socket.id);
      if (playerSeat) {
          playerName = playerSeat.playerName;
          // Usar userId del asiento para buscar en users (más confiable)
          if (playerSeat.userId) {
              // El objeto users tiene claves como 'user_a', 'user_b', etc.
              userIdForLookup = playerSeat.userId.toLowerCase();
          } else {
              // Fallback: usar playerName con prefijo 'user_'
              userIdForLookup = `user_${playerName.toLowerCase()}`;
          }
          console.log(`[REMATCH SERVER] Nombre encontrado en asientos: ${playerName}, userId: ${playerSeat.userId}, lookup: ${userIdForLookup}`);
      } else {
          // Fallback (menos fiable) si no se encontró en asientos
          playerName = connectedUsers[socket.id]?.username;
          userIdForLookup = playerName ? `user_${playerName.toLowerCase()}` : null;
          console.warn(`[REMATCH SERVER] No se encontró ${socket.id} en asientos, usando connectedUsers: ${playerName}`);
      }
      if (!playerName || !userIdForLookup) {
        console.error(`[REMATCH SERVER ERROR] No se pudo identificar al jugador para socket ${socket.id}.`);
        return socket.emit('rematchError', { message: 'Usuario no identificado.' });
      }
    
      // ▼▼▼ VALIDACIÓN DE CRÉDITOS PARA REVANCHA ▼▼▼
      // Usa la apuesta y moneda de la sala; verifica el saldo del usuario
      try {
          const userInfoForRematch = users[userIdForLookup];
          const roomBet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';

          if (!userInfoForRematch) {
              console.error(`[REMATCH CREDIT CHECK ERROR] No se encontró userInfo para ${playerName} (lookup: ${userIdForLookup}). Usuarios disponibles:`, Object.keys(users));
              return socket.emit('rematchError', { message: 'Error al verificar tus créditos.' });
          }

          const requiredCreditsInUserCurrency = convertCurrency(roomBet, roomCurrency, userInfoForRematch.currency, exchangeRates);

          if (userInfoForRematch.credits < requiredCreditsInUserCurrency) {
              console.log(`[REMATCH CREDIT CHECK FAILED] ${playerName} tiene ${userInfoForRematch.credits} ${userInfoForRematch.currency}, necesita ${requiredCreditsInUserCurrency.toFixed(2)} ${userInfoForRematch.currency}.`);
              return socket.emit('rematchError', {
                  insufficientCredits: true,
                  message: `No tienes suficientes créditos (${requiredCreditsInUserCurrency.toFixed(2)} ${userInfoForRematch.currency}) para la revancha.`
              });
          }
          console.log(`[REMATCH CREDIT CHECK OK] ${playerName} tiene créditos suficientes.`);
      } catch (e) {
          console.error(`[REMATCH CREDIT CHECK EXCEPTION] ${e?.message}`);
          return socket.emit('rematchError', { message: 'Error al validar créditos para la revancha.' });
      }
      // ▲▲▲ FIN VALIDACIÓN ▲▲▲
    
      // Verificar si el jugador ya confirmó
      if (room.rematchData.confirmedPlayers.includes(playerName)) {
        return socket.emit('rematchError', { message: 'Ya confirmaste la revancha.' });
      }
    
      // Agregar jugador a la lista de confirmados
      room.rematchData.confirmedPlayers.push(playerName);
    
      console.log(`[REMATCH SERVER] Jugadores confirmados ahora: [${room.rematchData.confirmedPlayers.join(', ')}]`);
      console.log(`[${roomId}] ${playerName} confirmó revancha. Total confirmados: ${room.rematchData.confirmedPlayers.length}`);
    
      // Verificar si hay suficientes jugadores para iniciar
      // const seatedPlayers = room.seats.filter(s => s !== null).length; // <-- ELIMINADA
      const expectedPlayers = room.seats.filter(s => s !== null).length; // Total de asientos ocupados AHORA
    
      // Verificar si el ganador anterior está entre los confirmados
      const winnerConfirmed = room.rematchData.confirmedPlayers.includes(room.rematchData.winnerName);
      console.log(`[REMATCH SERVER CHECK] Ganador (${room.rematchData.winnerName}) confirmado? ${winnerConfirmed}`);
    
      if (room.rematchData.confirmedPlayers.length >= 2 && winnerConfirmed) {
        room.rematchData.canStart = true;
        console.log(`[${roomId}] Revancha lista para iniciar (al menos 2 jugadores). Ganador confirmado: ${room.rematchData.winnerName}`);
      } else {
        room.rematchData.canStart = false;
        console.log(`[${roomId}] Revancha no lista. Confirmados: ${room.rematchData.confirmedPlayers.length} (se necesitan 2), Ganador confirmado: ${winnerConfirmed}`);
      }
    
      // Enviar actualización a todos los jugadores
      console.log(`[${roomId}] Enviando rematchUpdate:`, {
        confirmedPlayers: room.rematchData.confirmedPlayers,
        canStart: room.rematchData.canStart,
        winnerName: room.rematchData.winnerName,
        totalPlayers: expectedPlayers
      });
      console.log(`[REMATCH SERVER] -> Emitiendo rematchUpdate a ${roomId}. Datos:`, {
          confirmedPlayers: room.rematchData.confirmedPlayers,
          canStart: room.rematchData.canStart,
          winnerName: room.rematchData.winnerName,
          totalPlayers: expectedPlayers
      });
    
      io.to(roomId).emit('rematchUpdate', {
        confirmedPlayers: room.rematchData.confirmedPlayers,
        canStart: room.rematchData.canStart,
        winnerName: room.rematchData.winnerName,
        totalPlayers: expectedPlayers
      });
    });

    socket.on('startRematch', async (data) => {
      const { roomId } = data;
      const room = ludoRooms[roomId];
    
      if (!room || !room.rematchData) {
        return socket.emit('rematchError', { message: 'No hay revancha disponible.' });
      }
    
      // Verificar que el ganador anterior sea quien inicia
      if (room.rematchData.winnerId !== socket.id) {
        return socket.emit('rematchError', { message: 'Solo el ganador anterior puede iniciar la revancha.' });
      }
    
      if (!room.rematchData.canStart) {
        return socket.emit('rematchError', { message: 'No hay suficientes jugadores confirmados.' });
      }
    
      console.log(`[${roomId}] Iniciando revancha por ${room.rematchData.winnerName}. Estado ANTES: ${room.state}`);
      room.state = 'playing';
      console.log(`[${roomId}] Estado DESPUÉS: ${room.state}`);
    
      delete room.allowRematchConfirmation;
    
      // ▼▼▼ DÉBITO DE CRÉDITOS Y ACTUALIZACIÓN DEL BOTE ▼▼▼
      const roomBet = parseFloat(room.settings.bet) || 0;
      const roomCurrency = room.settings.betCurrency || 'USD';
      const initialConfirmedPlayerNames = [...(room.rematchData?.confirmedPlayers || [])];
      const gameType = room.settings.gameType || 'ludo';
      const isGroupsMode = gameType === 'parchis' && room.settings.parchisMode === '4-groups';

      console.log(`[REMATCH START] Validando y debitando ${roomBet} ${roomCurrency} a jugadores confirmados: [${initialConfirmedPlayerNames.join(', ')}]`);

      const failedPlayers = [];
      const playersToCharge = [];

      for (const playerName of initialConfirmedPlayerNames) {
          const playerSeat = room.seats.find(s => s && s.playerName === playerName);
          if (!playerSeat || !playerSeat.userId) {
              console.warn(`[REMATCH START] No se encontró asiento o userId para ${playerName}`);
              failedPlayers.push({ name: playerName, reason: 'Asiento no encontrado.' });
              continue;
          }

          const userInfo = users[playerSeat.userId];
          if (!userInfo) {
              console.error(`[REMATCH START] No se encontró userInfo para ${playerName} (userId: ${playerSeat.userId})`);
              failedPlayers.push({ name: playerName, reason: 'Información de usuario no encontrada.' });
              continue;
          }

          const totalCostInUserCurrency = convertCurrency(roomBet, roomCurrency, userInfo.currency, exchangeRates);

          if (userInfo.credits < totalCostInUserCurrency) {
              failedPlayers.push({ name: playerName, reason: 'Créditos insuficientes.' });
          } else {
              playersToCharge.push({ seat: playerSeat, userInfo: userInfo, playerName: playerName });
          }
      }

      if (failedPlayers.length > 0) {
          const errorMsg = 'No se puede iniciar la revancha. Jugadores sin fondos: ' + failedPlayers.map(p => p.name).join(', ');
          console.warn(`[${roomId}] Fallo al iniciar revancha: ${errorMsg}`);
          return socket.emit('rematchError', { message: errorMsg });
      }

      let totalPot = 0;
      for (const { seat, userInfo, playerName } of playersToCharge) {
          const totalCostInUserCurrency = convertCurrency(roomBet, roomCurrency, userInfo.currency, exchangeRates);
          userInfo.credits -= totalCostInUserCurrency;
          await updateUserCredits(seat.userId, userInfo.credits, userInfo.currency);
          console.log(`[${roomId}] COBRO REVANCHA: ${playerName} pagó ${totalCostInUserCurrency.toFixed(2)} ${userInfo.currency}.`);
          totalPot += roomBet;
          const playerSocket = io.sockets.sockets.get(seat.playerId);
          if (playerSocket) {
              playerSocket.emit('userStateUpdated', userInfo);
          }
      }

      console.log(`[REMATCH START] Débito completado. Nuevo bote: ${totalPot} ${roomCurrency}`);
    
      // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO ▼▼▼

      // --- INICIO: LÓGICA DE RE-ASIGNACIÓN DIAGONAL PARA 2 JUGADORES EN REVANCHA ---
    
      // Usamos la lista de jugadores que pagaron (los confirmados)
      const confirmedPlayerNames = playersToCharge.map(p => p.playerName);
    
      if (!isGroupsMode) {
          if (confirmedPlayerNames.length === 2) {
              console.log(`[${roomId}] (Rematch) Detectados 2 jugadores. Verificando asientos...`);

              // Encontrar los asientos de los dos jugadores confirmados
              const player1Seat = room.seats.find(s => s && s.playerName === confirmedPlayerNames[0]);
              const player2Seat = room.seats.find(s => s && s.playerName === confirmedPlayerNames[1]);

              if (player1Seat && player2Seat) {
                  const index1 = room.seats.indexOf(player1Seat);
                  const index2 = room.seats.indexOf(player2Seat);
                
                  // Calcular la diferencia (0=mismo, 1=adyacente, 2=diagonal, 3=adyacente)
                  const diff = Math.abs(index1 - index2);

                  if (diff === 1 || diff === 3) {
                      // ¡Están adyacentes! Debemos mover al jugador 2 (player2Seat)
                      console.log(`[${roomId}] (Rematch) Jugadores adyacentes (${index1} y ${index2}). Re-asignando...`);

                      const newIndexForP2 = (index1 + 2) % 4; // El asiento diagonal a P1

                      if (room.seats[newIndexForP2] === null) {
                          // El asiento diagonal está libre, movemos al jugador 2
                          const player2Data = { ...player2Seat }; // Copiamos sus datos
                        
                          // 1. Asignar el nuevo color (del nuevo asiento)
                          player2Data.color = room.settings.colorMap[newIndexForP2]; 
                        
                          // 2. Mover los datos al nuevo asiento
                          room.seats[newIndexForP2] = player2Data;
                        
                          // 3. Vaciar el asiento antiguo
                          room.seats[index2] = null;
                        
                          console.log(`[${roomId}] (Rematch) Jugador ${player2Data.playerName} movido de ${index2} (Color ${player2Seat.color}) a ${newIndexForP2} (Color ${player2Data.color}).`);
                      } else {
                          // Esto no debería ocurrir si solo hay 2 jugadores, pero es un fallback
                          console.warn(`[${roomId}] (Rematch) Intento de re-asignación fallido. El asiento diagonal ${newIndexForP2} estaba ocupado.`);
                      }
                  } else {
                      console.log(`[${roomId}] (Rematch) Jugadores ya están en diagonal (${index1} y ${index2}). No se requiere re-asignación.`);
                  }
              }
          }
      } else {
          console.log(`[${roomId}] (Rematch) Modo Parejas: Se mantienen los asientos fijos. Los huecos libres podrán ser llenados por nuevos jugadores.`);
      }
      // Lógica de reasignación diagonal
      if (!isGroupsMode) {
          if (confirmedPlayerNames.length === 2) {
              console.log(`[${roomId}] (Rematch) Detectados 2 jugadores. Verificando asientos...`);
              const player1Seat = room.seats.find(s => s && s.playerName === confirmedPlayerNames[0]);
              const player2Seat = room.seats.find(s => s && s.playerName === confirmedPlayerNames[1]);

              if (player1Seat && player2Seat) {
                  const index1 = room.seats.indexOf(player1Seat);
                  const index2 = room.seats.indexOf(player2Seat);
                  const diff = Math.abs(index1 - index2);

                  if (diff === 1 || diff === 3) {
                      console.log(`[${roomId}] (Rematch) Jugadores adyacentes. Re-asignando...`);
                      const newIndexForP2 = (index1 + 2) % 4;
                      if (room.seats[newIndexForP2] === null) {
                          const player2Data = { ...player2Seat };
                          player2Data.color = room.settings.colorMap[newIndexForP2]; 
                          room.seats[newIndexForP2] = player2Data;
                          room.seats[index2] = null;
                      }
                  }
              }
          }
      }

      // Reiniciar juego
      const pieceCount = room.settings.pieceCount || 4;
      let initialPieces = {};
      const allColorsForPieces = ['yellow', 'green', 'red', 'blue'];
      allColorsForPieces.forEach(color => {
        initialPieces[color] = [];
        for (let i = 0; i < pieceCount; i++) {
          let pieceState = 'base';
          let piecePosition = -1;
          if (room.settings.autoExit === 'auto') {
            pieceState = 'active';
            piecePosition = room.gameState.board.start[color];
          }
          initialPieces[color].push({
            id: `${color}-${i + 1}`,
            color: color,
            state: pieceState,
            position: piecePosition,
          });
        }
      });
    
      room.state = 'playing';
      room.gameState.pot = totalPot;
      room.gameState.turn = {
        playerIndex: -1,
        canRoll: true,
        dice: [0, 0],
        moves: [],
        doublesCount: 0,
        isMoving: false
      };
      room.gameState.pieces = initialPieces;

      console.log(`[${roomId}] Jugadores confirmados que jugarán: [${confirmedPlayerNames.join(', ')}]`);

      room.seats.forEach((seat, index) => {
        if (seat) {
          if (confirmedPlayerNames.includes(seat.playerName) && room.seats[index] !== null) {
              seat.status = 'playing';
          } else {
              room.seats[index] = null;
          }
        }
      });

      const winnerSeatIndex = room.seats.findIndex(s => s && s.playerId === room.rematchData.winnerId);
      if (winnerSeatIndex !== -1) {
          room.gameState.turn.playerIndex = winnerSeatIndex;
          room.gameState.turn.canRoll = true;
      } else {
          room.gameState.turn.playerIndex = 0;
          room.gameState.turn.canRoll = true;
      }

      delete room.rematchData;
      io.to(roomId).emit('ludoResetBoard');

      io.to(roomId).emit('rematchStarted', {
        message: 'Nueva partida iniciada',
        gameState: room.gameState,
        seats: room.seats
      });
      
      io.to(roomId).emit('potUpdated', { 
        newPotValue: totalPot, 
        isPenalty: false 
      });
      
      console.log(`[${roomId}] Revancha iniciada. Bote: ${totalPot} ${roomCurrency}`);
      broadcastLudoRoomListUpdate(io);
    });

}); // <--- ESTA LLAVE CIERRA TODO EL BLOQUE io.on('connection'). ¡ES CRÍTICA!

// --- INICIALIZACIÓN DEL MOTOR DE LUDO ---
initLudoEngine(io.of('/ludo'), {
  userDirectory: inMemoryUsers,
  exchangeRates,
  commissionLog
});

// Helper para iconos
function getSuitIcon(s) { if(s==='hearts')return'♥'; if(s==='diamonds')return'♦'; if(s==='clubs')return'♣'; if(s==='spades')return'♠'; return ''; }

// --- PING AUTOMÁTICO ---
const PING_INTERVAL_MS = 5 * 60 * 1000;

const selfPing = () => {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) return;
    const https = require('https');
    console.log(`Ping automático iniciado a: ${url}`);
    https.get(url, (res) => {
        if (res.statusCode === 200) {
            console.log(`Ping exitoso a ${url}. Estado: ${res.statusCode}.`);
        } else {
            console.error(`Ping fallido a ${url}. Estado: ${res.statusCode}.`);
        }
    }).on('error', (err) => {
        console.error(`Error en el ping automático: ${err.message}`);
    });
};

setTimeout(() => {
    setInterval(selfPing, PING_INTERVAL_MS);
}, 30000);

// --- SERVIDOR ESCUCHANDO ---
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
  if (DISABLE_DB) {
    console.log('⚠️ Base de datos desactivada (modo local). Usando usuarios en memoria.');
  } else {
    console.log('✅ Base de datos PostgreSQL habilitada.');
  }
  
  if (!DISABLE_DB) {
    try {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        ORDER BY ordinal_position
      `);
      console.log('📋 Estructura de la tabla users:');
      result.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } catch (error) {
      console.error('❌ Error verificando estructura de la tabla:', error);
    }
  }
  
  setInterval(() => {
    const now = Date.now();
    if (ludoChatLastMessageTime > 0 && (now - ludoChatLastMessageTime) >= CHAT_CLEANUP_INTERVAL_MS) {
      console.log('[Chat Ludo] Limpiando chat');
      ludoLobbyChatHistory = [];
      ludoChatLastMessageTime = 0;
      io.emit('ludoLobbyChatCleared');
    }
    if (la51ChatLastMessageTime > 0 && (now - la51ChatLastMessageTime) >= CHAT_CLEANUP_INTERVAL_MS) {
      console.log('[Chat La 51] Limpiando chat');
      la51LobbyChatHistory = [];
      la51ChatLastMessageTime = 0;
      io.emit('la51LobbyChatCleared');
    }
  }, 60000);
}); // Fin del server.listen
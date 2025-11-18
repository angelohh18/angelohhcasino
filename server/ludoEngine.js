function initLudoEngine(ludoIo, sharedState = {}) {
  // Función para manejar cuando el host deja la sala
  function handleHostLeaving(room, leavingPlayerId, io) {
      if (room && room.hostId === leavingPlayerId) {
          const newHost = room.seats.find(s => s && s.playerId !== leavingPlayerId);

          if (newHost) {
              room.hostId = newHost.playerId;
              console.log(`Anfitrión ${leavingPlayerId} ha salido. Nuevo anfitrión: ${newHost.playerName}.`);

              (io || ludoIo).to(room.roomId).emit('newHostAssigned', {
                  hostName: newHost.playerName,
                  hostId: newHost.playerId
              });
          }
      }
  }

  // Función helper para limpiar una reconexión específica (reconnectSeats + timeout)
  function clearReconnection(roomId, userId) {
      const timeoutKey = `${roomId}_${userId}`;
      if (reconnectTimeouts[timeoutKey]) {
          clearTimeout(reconnectTimeouts[timeoutKey]);
          delete reconnectTimeouts[timeoutKey];
          console.log(`[Cleanup] Timeout de reconexión limpiado para ${userId} en sala ${roomId}`);
      }

      const room = rooms[roomId];
      if (room && room.reconnectSeats && room.reconnectSeats[userId]) {
          delete room.reconnectSeats[userId];
          if (Object.keys(room.reconnectSeats).length === 0) {
              delete room.reconnectSeats;
          }
      }
  }

  // Función para limpiar timeouts de reconexión expirados en una sala
  function cleanupExpiredReconnections(roomId, io) {
      const room = rooms[roomId];
      if (!room || !room.reconnectSeats) return;

      const now = Date.now();
      const expiredUserIds = [];

      for (const [userId, reconnectData] of Object.entries(room.reconnectSeats)) {
          // Si la reconexión tiene timestamp y ha expirado
          if (reconnectData.timestamp && (now - reconnectData.timestamp > RECONNECT_TIMEOUT_MS)) {
              expiredUserIds.push(userId);
          }
      }

      // Limpiar reconexiones expiradas
      expiredUserIds.forEach(userId => {
          console.log(`[Cleanup] Limpiando reconexión expirada para usuario ${userId} en sala ${roomId}`);
          clearReconnection(roomId, userId);
      });
  }

  // Función para verificar si hay sockets conectados a una sala
  function hasConnectedSockets(roomId, io) {
      const ioInstance = io || ludoIo;
      if (!ioInstance || !ioInstance.sockets || !ioInstance.sockets.adapter || !ioInstance.sockets.adapter.rooms) {
          return false;
      }
      const room = ioInstance.sockets.adapter.rooms.get(roomId);
      return room && room.size > 0;
  }

  // Función para verificar y limpiar salas vacías
  function checkAndCleanRoom(roomId, io) {
      const room = rooms[roomId];

      if (!room) {
          console.log(`[Cleanup] Sala ${roomId} ya no existe.`);
          broadcastRoomListUpdate(ludoIo); // Notificar por si acaso
          return;
      }

      // 0. Limpiar reconexiones expiradas primero
      cleanupExpiredReconnections(roomId, io);

      // 1. Contar jugadores en los asientos.
      const playersInSeats = room.seats.filter(s => s !== null).length;

      // 2. Contar reconexiones pendientes (después de limpiar expiradas)
      const pendingReconnections = room.reconnectSeats ? Object.keys(room.reconnectSeats).length : 0;

      // 3. Verificar si hay sockets conectados a la sala
      const hasSockets = hasConnectedSockets(roomId, io);

      // 4. Lógica de eliminación mejorada
      if (playersInSeats === 0 && pendingReconnections === 0 && !hasSockets) {
          // SOLO si no hay jugadores, no hay reconexiones pendientes, Y no hay sockets conectados
          console.log(`[Cleanup] Sala ${roomId} vacía (Jugadores: 0, Reconexiones: 0, Sockets: 0). Eliminando AHORA.`);

          // Limpiar todos los timeouts relacionados con esta sala
          Object.keys(reconnectTimeouts).forEach(key => {
              if (key.startsWith(`${roomId}_`)) {
                  clearTimeout(reconnectTimeouts[key]);
                  delete reconnectTimeouts[key];
              }
          });

          delete rooms[roomId];
      } else {
          console.log(`[Cleanup] Mesa ${roomId} no se elimina (Jugadores: ${playersInSeats}, Reconexiones: ${pendingReconnections}, Sockets conectados: ${hasSockets}).`);

          // Si la sala está vacía pero tiene reconexiones pendientes, la limpieza se hará automáticamente
          // cuando expire el timeout de reconexión o cuando se desconecten todos los sockets
          // (startPeriodicCleanup no está implementada, pero no es crítica)
      }

      // 5. Notificar a todos los clientes del lobby sobre el cambio
      broadcastRoomListUpdate(ludoIo);
  }

  // Función para actualizar lista de usuarios
  function broadcastUserListUpdate(io) {
      const userList = Object.values(connectedUsers);
      (io || ludoIo).emit('updateUserList', userList);
      console.log(`[User List] Transmitiendo lista actualizada de ${userList.length} usuarios.`);
  }

  // Función para obtener información sanitizada de la sala (sin datos sensibles)
  function getSanitizedRoomForClient(room) {
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

  // Función para generar ID de sala
  function generateRoomId() {
    return `room-${Math.random().toString(36).slice(2, 10)}`;
  }

  const userDirectory = sharedState.userDirectory || new Map();
  const exchangeRates = sharedState.exchangeRates || {
      'EUR': { 'USD': 1.05, 'COP': 4500 },
      'USD': { 'EUR': 1 / 1.05, 'COP': 4500 },
      'COP': { 'EUR': 1 / 4500, 'USD': 1 / 4500 }
  };
  const commissionLog = sharedState.commissionLog || [];

  function normalizeUserKey(key) {
      if (typeof key !== 'string') return '';
      return key.toLowerCase();
  }

  const users = new Proxy({}, {
      get(_, prop) {
          if (typeof prop !== 'string') {
              return undefined;
          }
          return userDirectory.get(normalizeUserKey(prop));
      },
      set(_, prop, value) {
          if (typeof prop === 'string' && value) {
              const normalized = normalizeUserKey(prop);
              const record = { ...(value || {}), username: normalizeUserKey(value.username || prop) };
              userDirectory.set(normalized, record);
          }
          return true;
      },
      deleteProperty(_, prop) {
          if (typeof prop === 'string') {
              userDirectory.delete(normalizeUserKey(prop));
          }
          return true;
      },
      ownKeys() {
          return Array.from(userDirectory.keys());
      },
      getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
      }
  });

  // Estado del servidor
  let rooms = {}; // Estado de las mesas se mantiene en memoria
  let connectedUsers = {}; // Objeto para rastrear usuarios activos
  let lobbyChatHistory = [];
  const LOBBY_CHAT_HISTORY_LIMIT = 50;
  let reconnectTimeouts = {}; // Mapa para rastrear timeouts de reconexión: {roomId_userId: timeoutId}
  const RECONNECT_TIMEOUT_MS = 5000; // 5 segundos para reconexión
  const ORPHAN_ROOM_CLEANUP_INTERVAL_MS = 5000; // Limpiar salas huérfanas cada 5 segundos
  let periodicCleanupInterval = null; // Intervalo para limpieza periódica (solo cuando hay salas vacías)

  // Función para convertir moneda
  function convertCurrency(amount, fromCurrency, toCurrency, rates) {
      if (fromCurrency === toCurrency) {
          return amount;
      }
      if (rates[fromCurrency] && rates[fromCurrency][toCurrency]) {
          return amount * rates[fromCurrency][toCurrency];
      }
      if (rates[toCurrency] && rates[toCurrency][fromCurrency]) {
           return amount / rates[toCurrency][fromCurrency];
      }
      return amount; 
  }

  // Función para actualizar lista de salas
  function broadcastRoomListUpdate(io) {
      (io || ludoIo).emit('updateRoomList', Object.values(rooms));
      console.log('[Broadcast] Se ha actualizado la lista de mesas para todos los clientes.');
  }

  // Función para manejar la salida de un jugador
  async function handlePlayerDeparture(roomId, leavingPlayerId, io) {
      const room = rooms[roomId];

      if (!room) return;

      console.log(`Gestionando salida del jugador ${leavingPlayerId} de la sala ${roomId}.`);

      if (room.spectators) {
          room.spectators = room.spectators.filter(s => s.playerId !== leavingPlayerId);
      }

      const seatIndex = room.seats.findIndex(s => s && s.playerId === leavingPlayerId);
      if (seatIndex === -1) {
          (io || ludoIo).to(roomId).emit('spectatorListUpdated', { spectators: room.spectators });
          checkAndCleanRoom(roomId, io);
          return;
      }

      const leavingPlayerSeat = { ...room.seats[seatIndex] };
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

              (io || ludoIo).to(roomId).emit('rematchUpdate', {
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

      // ▼▼▼ INICIO DEL BLOQUE RESTAURADO ▼▼▼
      const shouldReserveSeatForReconnect = room.state === 'waiting';
      if (shouldReserveSeatForReconnect) {
          room.reconnectSeats = room.reconnectSeats || {};

          // Limpiar timeout anterior si existe
          const timeoutKey = `${roomId}_${leavingPlayerSeat.userId}`;
          if (reconnectTimeouts[timeoutKey]) {
              clearTimeout(reconnectTimeouts[timeoutKey]);
              delete reconnectTimeouts[timeoutKey];
          }

          // Guardar datos de reconexión con timestamp
          room.reconnectSeats[leavingPlayerSeat.userId] = {
              seatIndex,
              seatData: {
                  playerName: leavingPlayerSeat.playerName,
                  avatar: leavingPlayerSeat.avatar,
                  userId: leavingPlayerSeat.userId,
                  status: 'waiting',
                  color: leavingPlayerSeat.color
              },
              timestamp: Date.now() // Agregar timestamp para expiración
          };

          // Configurar timeout para limpiar reconexión si no se reconecta
          reconnectTimeouts[timeoutKey] = setTimeout(() => {
              console.log(`[${roomId}] Timeout de reconexión expirado para usuario ${leavingPlayerSeat.userId}`);
              clearReconnection(roomId, leavingPlayerSeat.userId);
              // Verificar si la sala debe eliminarse ahora
              checkAndCleanRoom(roomId, io);
          }, RECONNECT_TIMEOUT_MS);

          console.log(`[${roomId}] Jugador ${playerName} (asiento ${seatIndex}) se desconectó en espera. Liberando asiento (reservado para reconexión por ${RECONNECT_TIMEOUT_MS/1000}s).`);
          room.seats[seatIndex] = null;
      } else {
          console.log(`[${roomId}] Jugador ${playerName} (asiento ${seatIndex}) se desconectó durante el juego/revancha.`);
          room.seats[seatIndex] = null; 
      }
      // ▲▲▲ FIN DEL BLOQUE RESTAURADO ▲▲▲

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

              const winners = [opponentSeat1, opponentSeat2].filter(Boolean);
              const winningsPerPlayer = winners.length > 0 ? finalWinnings / winners.length : 0;
              const winningPlayersPayload = [];
              const roomCurrency = room.settings.betCurrency || 'USD';

              winners.forEach(seatInfo => {
                  if (!seatInfo) return;
                  const winnerUsername = seatInfo.userId ? seatInfo.userId.replace('user_', '') : null;
                  const winnerInfo = winnerUsername ? users[winnerUsername.toLowerCase()] : null;

                  if (winnerInfo) {
                      const winningsInUserCurrency = convertCurrency(winningsPerPlayer, roomCurrency, winnerInfo.currency, exchangeRates);
                      winnerInfo.credits += winningsInUserCurrency;
                      console.log(`[${roomId}] PAGO REALIZADO (Abandono Grupo): ${winnerUsername} recibe ${winningsPerPlayer.toFixed(2)} ${roomCurrency}`);
                      const winnerSocket = ludoIo.sockets.sockets.get(seatInfo.playerId);
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
                      console.warn(`[${roomId}] PAGO FALLIDO (Abandono Grupo): No se encontró userInfo para ${winnerUsername}.`);
                  }
              });

              const playersWhoPlayed = room.gameState.playersAtStart || [];

              // 3. Usar los datos del HOST ÚNICO para 'rematchData'
              room.rematchData = {
                  winnerId: rematchHostId,       // <-- CORREGIDO
                  winnerName: rematchHostName,   // <-- CORREGIDO
                  winnerColor: rematchHostColor, // <-- CORREGIDO
                  confirmedPlayers: [],
                  canStart: false,
                  expectedPlayers: playersWhoPlayed.length
              };

              // 4. Usar el NOMBRE DE VISUALIZACIÓN para 'ludoGameOver'
              (io || ludoIo).to(roomId).emit('ludoGameOver', {
                  winnerName: winnerDisplayName, // <-- Muestra "JugadorA & JugadorB"
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

              return; // Salir de la función handlePlayerDeparture
          }
          // ▲▲▲ FIN DEL REEMPLAZO ▲▲▲

          const username = leavingPlayerSeat.userId.replace('user_', '');
          const userInfo = users[username.toLowerCase()];
          const bet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';
          (io || ludoIo).to(roomId).emit('ludoFoulPenalty', { type: 'abandon', playerName: playerName, bet: bet.toLocaleString('es-ES'), currency: roomCurrency });

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

              // --- INICIO: PAGO DE PREMIOS (Añadido) ---
              const winnerUsername = winnerSeat.userId.replace('user_', '');
              const winnerInfo = users[winnerUsername.toLowerCase()];
              const roomCurrency = room.settings.betCurrency || 'USD';

              if (winnerInfo) {
                  // Convertir la ganancia (en moneda de la sala) a la moneda del usuario
                  const winningsInUserCurrency = convertCurrency(finalWinnings, roomCurrency, winnerInfo.currency, exchangeRates);

                  // Sumar los créditos
                  winnerInfo.credits += winningsInUserCurrency;

                  console.log(`[${roomId}] PAGO REALIZADO (Abandono): ${winnerUsername} (Ganador) recibe ${finalWinnings.toFixed(2)} ${roomCurrency} (Equivalente a ${winningsInUserCurrency.toFixed(2)} ${winnerInfo.currency}).`);
                  console.log(`[${roomId}] Saldo anterior: ${(winnerInfo.credits - winningsInUserCurrency).toFixed(2)} ${winnerInfo.currency}. Saldo nuevo: ${winnerInfo.credits.toFixed(2)} ${winnerInfo.currency}.`);

                  // Notificar al ganador (si está conectado) de su nuevo saldo
                  const winnerSocket = ludoIo.sockets.sockets.get(winnerSeat.playerId);
                  if (winnerSocket) {
                      winnerSocket.emit('userStateUpdated', winnerInfo);
                  }
              } else {
                  console.warn(`[${roomId}] PAGO FALLIDO (Abandono): No se encontró userInfo para ${winnerUsername} (ID: ${winnerSeat.userId}).`);
              }
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
              (io || ludoIo).to(roomId).emit('ludoGameOver', {
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
          } else if (remainingActivePlayers.length > 1) {
              (io || ludoIo).to(roomId).emit('ludoGameStateUpdated', {
                  newGameState: room.gameState, 
                  seats: room.seats,            
                  moveInfo: { type: 'player_left', playerColor: playerColor } 
              });
              if (room.gameState && room.gameState.turn.playerIndex === seatIndex) {
                  console.log(`[${roomId}] Era el turno del jugador que abandonó. Pasando al siguiente INMEDIATAMENTE...`);
                  passTurn(room, io);
              }
          } else {
              console.log(`[${roomId}] No quedan jugadores activos después del abandono.`);
          }

      } else if (leavingPlayerSeat.status === 'waiting') {
          console.log(`Jugador ${playerName} ha salido mientras esperaba (estado: ${room.state}).`);
          (io || ludoIo).to(roomId).emit('playerAbandoned', {
              message: `${playerName} ha abandonado la mesa.`
          });

          console.log(`[${roomId}] Sincronizando asientos tras abandono en espera.`);
          (io || ludoIo).to(roomId).emit('playerJoined', getSanitizedRoomForClient(room));

      }

      handleHostLeaving(room, leavingPlayerId, io);
      // REEMPLAZO: Llamamos a checkAndCleanRoom en lugar de solo transmitir.
      // checkAndCleanRoom se encargará de eliminar la sala si está vacía Y de transmitir la lista actualizada.
      checkAndCleanRoom(roomId, io);
  }

  // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO ▼▼▼
  /**
   * Mapeo de los "puentes" en el tablero central.
   * La casilla 'key' es seguida por la casilla 'value'.
   */
  const boardJumps = {
      7: 8,   // Puente Amarillo (Entrada)
      9: 10,  // Puente Amarillo (Salida)
      24: 25, // Puente Azul (Entrada)
      26: 27, // Puente Azul (Salida)
      41: 42, // Puente Rojo (Entrada)
      43: 44, // Puente Rojo (Salida)
      58: 59, // Puente Verde (Entrada)
      60: 61  // Puente Verde (Salida)
  };
  // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

  function areAllPiecesInGoal(room, color) {
      if (!room || !room.gameState || !room.gameState.pieces || !room.gameState.board) return false;
      const pieces = room.gameState.pieces[color];
      const goalCell = room.gameState.board.goal?.[color];
      if (!pieces || goalCell === undefined) return false;
      if (pieces.length === 0) return false;
      return pieces.every(piece => piece.state === 'active' && piece.position === goalCell);
  }

  function getControlledColorForSeat(room, seatIndex) {
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

  // ▼▼▼ AÑADE ESTA NUEVA FUNCIÓN ▼▼▼
  /**
   * Pasa el turno al siguiente jugador activo en la sala.
   * @param {object} room - El objeto de la sala.
   * @param {Server} io - La instancia de Socket.IO.
   * @param {boolean} [isPunishmentTurn=false] - Indica si el turno se pasa por un castigo (ej. tercer doble).
   */
  function passTurn(room, io, isPunishmentTurn = false) {
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
              nextPlayerIndex = foundSeatIndex;
              nextPlayer = seats[foundSeatIndex];
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

      ludoIo.to(room.roomId).emit('ludoTurnChanged', {
          nextPlayerIndex,
          nextPlayerId: nextPlayer.playerId,
          nextPlayerName: nextPlayer.playerName,
          newGameState: room.gameState
      });
  }

  /**
   * Maneja la lógica de lanzamiento de dados para partidas de Parchís.
   * @param {object} room - Objeto de la sala actual.
   * @param {Server} io - Instancia de Socket.IO.
   * @param {Socket} socket - Socket del jugador que lanza.
   * @param {number} dice1 - Primer dado.
   * @param {number} dice2 - Segundo dado.
   */
  async function handleParchisRoll(room, io, socket, dice1, dice2) {
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
      const playerColor = getControlledColorForSeat(room, mySeatIndex) || seatColor;
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
              let applyPunishment = true;
              const lastMovedPieceId = turnData.lastMovedPieceId;
              if (lastMovedPieceId) {
                  const piece = room.gameState.pieces[playerColor]?.find((p) => p.id === lastMovedPieceId);
                  const homeStretch = room.gameState.board.home_stretch[playerColor] || [];
                  if (piece && homeStretch.includes(piece.position)) {
                      applyPunishment = false;
                      console.log(`[Parchís] Castigo evitado: ${lastMovedPieceId} está en la recta final.`);
                  }
              }

              if (applyPunishment && turnData.lastMovedPieceId) {
                  const punishedPiece = room.gameState.pieces[playerColor]?.find((p) => p.id === turnData.lastMovedPieceId);
                  if (punishedPiece) {
                      punishedPiece.state = 'base';
                      punishedPiece.position = -1;
                      console.log(`[Parchís] Ficha ${punishedPiece.id} castigada de vuelta a la base.`);

                      // ▼▼▼ BLOQUE A AÑADIR (INICIO) ▼▼▼
                      // Emitir la falta a TODOS los jugadores en la sala
                      ludoIo.to(room.roomId).emit('ludoFoulPenalty', {
                          type: 'three_doubles',
                          playerName: playerName,
                          penalizedPieceId: punishedPiece.id
                      });
                      // ▲▲▲ BLOQUE A AÑADIR (FIN) ▲▲▲
                  }
              }

              turnData.canRoll = false;
              turnData.canRollAgain = false;
              turnData.doublesCount = 0;
              turnData.moves = [];
              turnData.possibleMoves = [];

              ludoIo.to(room.roomId).emit('ludoDiceRolled', {
                  playerId: socket.id,
                  playerName,
                  diceValues: [dice1, dice2],
                  isDouble: true,
                  turnData
              });

              setTimeout(() => passTurn(room, io, true), 2200);
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
      let blockadeJustCreatedOnStart = false; // <-- AÑADE ESTA LÍNEA

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
                  const activeRoom = rooms[roomId];
                  if (activeRoom) {
                      ludoIo.to(activeRoom.roomId).emit('ludoGameStateUpdated', {
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
          }, 2500); // <-- CAMBIADO DE 1200 A 2500
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
              const { finalPosition } = calculatePath(playerColor, piece.position, prizeDistance, boardRulesForPrize, allPieces, 'parchis');
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

              ludoIo.to(room.roomId).emit('ludoDiceRolled', {
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

                  ludoIo.to(room.roomId).emit('ludoDiceRolled', {
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

                  ludoIo.to(room.roomId).emit('ludoDiceRolled', {
                      playerId: socket.id,
                      playerName,
                      diceValues: [dice1, dice2],
                      isDouble,
                      turnData
                  });

                  setTimeout(() => passTurn(room, io), 2200);
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
          const blockadePositionsSet = new Set();
          activePiecesForBlock.forEach(p => {
              if (p.position === -1) return;
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
                      const { finalPosition } = calculatePath(playerColor, piece.position, dieValue, boardRulesForBlock, room.gameState.pieces, 'parchis');

                      if (finalPosition !== null) {
                          blockadeBreakMoves.push({
                              type: 'move_active_piece',
                              startPosition: pos, // <-- AÑADE ESTA LÍNEA
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
                  if (isKillMove(targetPosition, playerColor, room.gameState.pieces, boardRules)) {
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
                          const { finalPosition: posDie } = calculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, 'parchis');
                          if (posDie !== null) {
                              possibleMoves.push({
                                  type: 'move_active_piece', pieceId: piece.id, diceValue: dieValue, targetPosition: posDie
                              });
                          }
                          // Mover con la suma (6-6 -> 12)
                          const { finalPosition: posSum } = calculatePath(playerColor, piece.position, dieValue + dieValue, boardRules, room.gameState.pieces, 'parchis');
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
                          if (rooms[roomId] && rooms[roomId].state === 'playing') {
                              // 'piecesActivated' fue llenado por la llamada a activatePieceFromBase()
                              ludoIo.to(roomId).emit('ludoGameStateUpdated', {
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
                  ludoIo.to(room.roomId).emit('ludoDiceRolled', {
                      playerId: socket.id, playerName, diceValues: [dice1, dice2], isDouble, turnData
                  });

                  setTimeout(() => {
                      if (rooms[roomId] && rooms[roomId].state === 'playing') {
                          const { path } = calculatePath(playerColor, startPosition, dieValue, boardRules, room.gameState.pieces, 'parchis');
                          ludoIo.to(roomId).emit('ludoGameStateUpdated', {
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
                          const { finalPosition } = calculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, 'parchis');
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
                  const { finalPosition } = calculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, 'parchis');
                  if (finalPosition !== null) {
                      // ▼▼▼ ¡LÍNEA AÑADIDA! ▼▼▼
                      const isKill = isKillMove(finalPosition, playerColor, room.gameState.pieces, boardRules);

                      possibleMoves.push({
                          type: 'move_active_piece',
                          pieceId: piece.id,
                          diceValue: dieValue,
                          targetPosition: finalPosition,
                          isKill: isKill // <-- ¡PROPIEDAD AÑADIDA!
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
          ludoIo.to(room.roomId).emit('ludoDiceRolled', {
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
          ludoIo.to(room.roomId).emit('ludoDiceRolled', {
              playerId: socket.id,
              playerName,
              diceValues: [dice1, dice2],
              isDouble,
              turnData
          });

          // Pasar el turno después de una breve espera
          setTimeout(() => passTurn(room, io), 2200);
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
          ludoIo.to(room.roomId).emit('ludoDiceRolled', {
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

      ludoIo.to(room.roomId).emit('ludoDiceRolled', {
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
              ludoIo.to(room.roomId).emit('ludoDiceRolled', {
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
              setTimeout(() => passTurn(room, io), 2200); // Pasar el turno
              return; // FIN
          }
      }

      // Si hay movimientos, verificar si se deben pasar dados restantes (Regla parchís)
      if (remainingDice.length === 0 && !isDouble) {
          turnData.canRoll = false;
          setTimeout(() => passTurn(room, io), 2200);
      }
      // ▲▲▲ BLOQUE A AÑADIR (FIN) ▲▲▲

      // (Bloque legacy de “sin movimientos” sustituido por la lógica centralizada previa)
  }

  /**
   * Verifica si un movimiento a una posición específica resultaría en una matanza.
   * @param {number} targetPosition - La posición de destino.
   * @param {string} myColor - El color del jugador que está moviendo.
   * @param {object} pieces - El objeto gameState.pieces con todas las fichas.
   * @param {object} boardRules - El objeto gameState.board con las reglas.
   * @returns {boolean} - true si el movimiento mata a una ficha oponente.
   */
  function isKillMove(targetPosition, myColor, pieces, boardRules) {
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

  /**
   * Calcula la ruta y la casilla final para un movimiento.
   * @param {string} color - Color de la ficha ('yellow', 'green', 'red', 'blue').
   * @param {number} currentPosition - Posición actual de la ficha (-1 si está en base).
   * @param {number} diceValue - Valor del dado a mover.
   * @param {object} boardRules - El objeto gameState.board con las reglas.
   * @returns {{ finalPosition: number | null, path: number[] }} - Objeto con la posición final (o null si es inválido) y la ruta seguida.
   */
  function calculatePath(color, currentPosition, diceValue, boardRules, allPieces = {}, gameType = 'ludo') {
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
                  } else if (boardJumps[tempNextStep]) {
                      tempNextStep = boardJumps[tempNextStep];
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
              else if (boardJumps[newPosition]) {
                  nextStepPosition = boardJumps[newPosition];
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

  /**
   * Verifica si un jugador ha ganado (todas sus fichas están en la meta).
   * @param {object} room - El objeto de la sala.
   * @param {string} playerColor - El color del jugador que acaba de mover.
   * @returns {boolean} - True si el jugador ha ganado, false si no.
   */
  function checkWinCondition(room, playerColor) {
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

  // --- MANEJO DE SOCKETS ---
  ludoIo.on('connection', (socket) => {
    console.log('✅ Un jugador se ha conectado:', socket.id);
    console.log('ESTADO ACTUAL DE LAS MESAS EN EL SERVIDOR:', rooms);

    socket.emit('lobbyChatHistory', lobbyChatHistory);
    socket.emit('updateRoomList', Object.values(rooms));

      // --- LÓGICA PARA EL PANEL DE ADMIN ---

      socket.on('admin:requestUserList', async () => {
          socket.join('admin-room');
          console.log(`Socket ${socket.id} se ha unido a la sala de administradores.`);

          socket.emit('admin:commissionData', commissionLog);

          // Obtener usuarios desde memoria
          const allUsers = Object.values(users).map(u => ({
              id: 'user_' + u.username.toLowerCase(),
              username: u.username,
              credits: parseFloat(u.credits),
              currency: u.currency
          }));

              ludoIo.to('admin-room').emit('admin:userList', allUsers);
          console.log(`[Admin] Lista de ${allUsers.length} usuarios enviada desde memoria.`);
      });

      socket.on('admin:updateCredits', async ({ userId, newCredits, newCurrency }) => {
          const credits = parseFloat(newCredits);
          const username = userId.replace(/^user_/, '');

          if (!isNaN(credits) && ['EUR', 'USD', 'COP'].includes(newCurrency) && users[username]) {
              console.log(`[Admin] Actualizando datos en memoria para ${username}: ${credits} ${newCurrency}`);

              // Actualizamos el objeto en memoria
              users[username].credits = credits;
              users[username].currency = newCurrency;

              // Notificamos al usuario si está conectado
                for (const [id, socketInstance] of ludoIo.sockets) {
                      if (socketInstance.userId === userId) {
                      socketInstance.emit('userStateUpdated', users[username]);
                          break; 
                  }
              }

              // Reenviamos la lista actualizada al admin
              const allUsers = Object.values(users).map(u => ({
                  id: 'user_' + u.username.toLowerCase(),
                  username: u.username,
                  credits: parseFloat(u.credits),
                  currency: u.currency
              }));
              ludoIo.to('admin-room').emit('admin:userList', allUsers);
          } else {
              console.log(`[Admin] Error: datos inválidos o usuario ${username} no encontrado en memoria.`);
          }
      });

      socket.on('admin:deleteUser', async ({ userId }) => {
          console.log(`[Admin] Solicitud para eliminar al usuario ${userId}`);

          const username = userId.replace('user_', '');

          if (users[username]) {
              delete users[username];
              console.log(`[Admin] Usuario ${username} eliminado de la memoria.`);

              // Notificar al usuario si está conectado
              const userSocket = Object.keys(connectedUsers).find(
                  socketId => connectedUsers[socketId].name === username
              );

              if (userSocket) {
                  ludoIo.to(userSocket).emit('accountDeleted');
                  delete connectedUsers[userSocket];
              }

              // Reenviamos la lista actualizada al admin
              const allUsers = Object.values(users).map(u => ({
                  id: 'user_' + u.username.toLowerCase(),
                  username: u.username,
                  credits: parseFloat(u.credits),
                  currency: u.currency
              }));
              ludoIo.to('admin-room').emit('admin:userList', allUsers);
          } else {
              console.log(`[Admin] No se pudo eliminar al usuario ${username}, no se encontró en memoria.`);
              socket.emit('admin:errorDeletingUser', { userId });
          }
      });

      socket.on('requestInitialData', () => {
          socket.emit('updateRoomList', Object.values(rooms));
      });

      socket.on('userLoggedIn', async ({ username, currency }) => {
          if (!username || !currency) return;

          const userId = 'user_' + username.toLowerCase();
          socket.userId = userId;

          console.log(`🔐 Usuario logueado: ${username} (${socket.id})`);

          connectedUsers[socket.id] = {
              username: username,
              status: 'En el Lobby'
          };
          broadcastUserListUpdate(ludoIo);

          // Obtenemos los datos desde nuestro objeto 'users' en memoria
          const user = users[username.toLowerCase()];

          if (user) {
              if (user.currency !== currency) {
                  user.currency = currency; // Actualiza la moneda en memoria si es diferente
              }
              console.log(`[Lobby Login] Usuario ${userId} cargado desde memoria: ${user.credits} ${user.currency}`);
              socket.emit('userStateUpdated', user);
          } else {
              console.error(`❌ Error: el usuario '${username}' pasó el login pero no se encontró en memoria.`);
              // Creamos un usuario temporal para evitar que la app se rompa
              users[username.toLowerCase()] = {
                  username: username.toLowerCase(),
                  password_hash: '',
                  credits: 0.00,
                  currency: currency,
                  avatar_url: '',
              };
              socket.emit('userStateUpdated', users[username.toLowerCase()]);
          }

          // Actualizar el panel de admin con los usuarios en memoria
          const allUsers = Object.values(users).map(u => ({
              id: 'user_' + u.username.toLowerCase(),
              username: u.username,
              credits: parseFloat(u.credits),
              currency: u.currency
          }));
          ludoIo.to('admin-room').emit('admin:userList', allUsers);

          // Enviar historial del chat (vacío por ahora en memoria)
          socket.emit('lobbyChatHistory', lobbyChatHistory);
      });

      socket.on('admin:resetCommissions', () => {
          console.log(`[Admin] Se han reiniciado las ganancias acumuladas.`);
          commissionLog.length = 0;

          ludoIo.to('admin-room').emit('admin:commissionsReset');
      });

      socket.on('admin:requestRates', () => {
          socket.emit('admin:currentRates', exchangeRates);
      });

      socket.on('admin:updateRates', (newRates) => {
          Object.assign(exchangeRates, newRates);
          console.log('[Admin] Tasas de cambio actualizadas:', exchangeRates);
          ludoIo.to('admin-room').emit('admin:ratesUpdated', exchangeRates);
      });

    // --- LÓGICA DEL LOBBY ---

    socket.on('createLudoRoom', (settings) => {
      // ▼▼▼ LÓGICA DE `createLudoRoom` ACTUALIZADA ▼▼▼
      const username = connectedUsers[socket.id]?.username;

      if (!username) {
          console.error('❌ Usuario no autenticado intentando crear sala:', socket.id);
          return socket.emit('roomCreationFailed', { message: 'Debes iniciar sesión.' });
      }

      // ▼▼▼ CORRECCIÓN 1: Usar .toLowerCase() para encontrar al usuario ▼▼▼
      const userInfo = users[username.toLowerCase()];
      if (!userInfo) {
          console.error(`❌ No se encontró userInfo para ${username} (buscando como ${username.toLowerCase()})`);
          return socket.emit('roomCreationFailed', { message: 'Información de usuario no disponible.' });
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

      const roomId = generateRoomId();

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
          settings: {
              ...settings,
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
      newRoom.seats[hostSeatIndex] = {
          playerId: socket.id,
          playerName: username,
          avatar: userInfo.avatar_url,
          userId: settings.userId,
          status: 'waiting',
          color: hostColor // Asignar el color
      };

      rooms[roomId] = newRoom;
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

      broadcastRoomListUpdate(ludoIo);
      // ▲▲▲ FIN DE LA ACTUALIZACIÓN DE `createLudoRoom` ▲▲▲
    });

    socket.on('joinLudoRoom', ({ roomId, user }) => {
      // ▼▼▼ LÓGICA DE `joinLudoRoom` ACTUALIZADA ▼▼▼
      const room = rooms[roomId];

      if (!room) {
          return socket.emit('joinRoomFailed', { message: 'La sala no existe.' });
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

      const username = user.username;
      const userInfo = users[username.toLowerCase()];

      if (!userInfo) {
          return socket.emit('joinRoomFailed', { message: 'Información de usuario no disponible.' });
      }

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
          clearReconnection(roomId, user.userId);
      }

      const effectiveReconnectSeatInfo = (room.reconnectSeats && user.userId) ? room.reconnectSeats[user.userId] : null;

      // ▼▼▼ INICIO DEL BLOQUE REEMPLAZADO ▼▼▼
      // --- LÓGICA DE ASIGNACIÓN DE ASIENTOS (DIAGONAL OBLIGATORIA PARA 2 JUGADORES) ---
      let emptySeatIndex = -1;
      if (effectiveReconnectSeatInfo && room.seats[effectiveReconnectSeatInfo.seatIndex] === null) {
          emptySeatIndex = effectiveReconnectSeatInfo.seatIndex;
      }

      // Contar jugadores actuales
      const seatedPlayers = room.seats.filter(s => s !== null);
      const hostSeatIndex = room.settings.hostSeatIndex; // Asiento del anfitrión (puede estar vacío si se fue)

      if (emptySeatIndex === -1 && seatedPlayers.length === 1) {
          // ¡SOLO HAY UN JUGADOR! Forzar asiento diagonal.
          const existingPlayerSeatIndex = room.seats.findIndex(s => s !== null);
          const diagonalSeat = (existingPlayerSeatIndex + 2) % 4;

          if (room.seats[diagonalSeat] === null) {
              console.log(`[${roomId}] Asignación diagonal obligatoria: Jugador 1 en ${existingPlayerSeatIndex}, Jugador 2 asignado a ${diagonalSeat}.`);
              emptySeatIndex = diagonalSeat;
          } else {
              // Esto no debería pasar si solo hay 1 jugador, pero es un fallback
               console.warn(`[${roomId}] Error en lógica diagonal: Se detectó 1 jugador, pero el asiento diagonal ${diagonalSeat} está ocupado.`);
               // Continuar con la lógica normal...
          }
      }

      // Si la lógica diagonal no se aplicó (o falló), usar la lógica de prioridad normal
      if (emptySeatIndex === -1) {
          // 1. Calcular el orden de prioridad de los asientos RELATIVO al host
          const diagonalSeatHost = (hostSeatIndex + 2) % 4;
          const leftSeat = (hostSeatIndex + 1) % 4; // Izquierda del host (sentido horario)
          const rightSeat = (hostSeatIndex + 3) % 4; // Derecha del host (sentido horario)

          // 2. Buscar asiento diagonal (relativo al host)
          if (room.seats[diagonalSeatHost] === null) {
              emptySeatIndex = diagonalSeatHost;
          } else if (room.seats[leftSeat] === null) {
              emptySeatIndex = leftSeat;
          } else if (room.seats[rightSeat] === null) {
              emptySeatIndex = rightSeat;
          }
      }

      if (emptySeatIndex === -1) {
          // Si no hay asientos vacíos (o la lógica anterior falló), buscar el primer asiento disponible
          for (let i = 0; i < 4; i++) {
              if (room.seats[i] === null) {
                  emptySeatIndex = i;
                  break;
              }
          }

          // Si aún no hay asientos, la sala está llena
          if (emptySeatIndex === -1) {
              return socket.emit('joinRoomFailed', { message: 'La sala está llena.' });
          }
      }
      // --- FIN DE LÓGICA DE ASIGNACIÓN ---
  // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲

      // Obtener el color asignado a este asiento físico
      const reservedSeatData = (effectiveReconnectSeatInfo && effectiveReconnectSeatInfo.seatIndex === emptySeatIndex) ? effectiveReconnectSeatInfo.seatData : null;
      const assignedColor = reservedSeatData?.color || room.settings.colorMap[emptySeatIndex];

      room.seats[emptySeatIndex] = {
          playerId: socket.id,
          playerName: reservedSeatData?.playerName || username,
          avatar: reservedSeatData?.avatar || userInfo.avatar_url,
          userId: user.userId,
          status: reservedSeatData?.status || ((room.state === 'post-game') ? 'playing' : 'waiting'),
          color: assignedColor
      };

      if (effectiveReconnectSeatInfo) {
          clearReconnection(roomId, user.userId);
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

      ludoIo.to(roomId).emit('playerJoined', getSanitizedRoomForClient(room));
      broadcastRoomListUpdate(ludoIo);
      // ▲▲▲ FIN DE LA ACTUALIZACIÓN DE `joinLudoRoom` ▲▲▲
    });

    // --- CHAT DEL LOBBY ---

    socket.on('sendLobbyChat', (data) => {
        if (!data || !data.text || !data.sender) return;

        const newMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            from: data.sender,
            text: data.text,
            ts: Date.now()
        };

        lobbyChatHistory.push(newMessage);

        if (lobbyChatHistory.length > LOBBY_CHAT_HISTORY_LIMIT) {
            lobbyChatHistory.shift();
        }

        // Ya no guardamos en DB, solo en memoria
        console.log(`[Chat] ${data.sender}: ${data.text}`);

        ludoIo.emit('lobbyChatUpdate', newMessage);
    });

    // --- LÓGICA DEL JUEGO LUDO ---

    socket.on('joinLudoGame', (data) => {
      // ▼▼▼ FUNCIÓN 'joinLudoGame' ACTUALIZADA ▼▼▼
      const { roomId, userId } = data;

      if (!userId) {
          return socket.emit('ludoError', { message: 'Usuario no identificado.' });
      }

      const room = rooms[roomId];

      if (!room) {
          // Esto previene el error de la alerta
          return socket.emit('ludoError', { message: 'Sala no encontrada' }); 
      }

      // ▼▼▼ INICIO DEL BLOQUE RESTAURADO ▼▼▼
      if (room.state === 'waiting' && room.reconnectSeats && room.reconnectSeats[userId]) {
          const reservedInfo = room.reconnectSeats[userId];
          if (room.seats[reservedInfo.seatIndex] === null) {
              room.seats[reservedInfo.seatIndex] = {
                  ...reservedInfo.seatData,
                  userId,
                  playerId: socket.id
              };
              console.log(`[${roomId}] ${userId} recuperó su asiento reservado ${reservedInfo.seatIndex} al reconectarse.`);
          }
          clearReconnection(roomId, userId);
      }
      // ▲▲▲ FIN DEL BLOQUE RESTAURADO ▲▲▲

      // ▼▼▼ ¡ELIMINA O COMENTA ESTE BLOQUE COMPLETO! ▼▼▼
      /*
      // Permitir unirse si está en espera O en post-game (para revancha)
      if (room.state !== 'waiting' && room.state !== 'post-game') {
           console.warn(`[JOIN REJECTED] Intento de unirse a sala ${roomId} en estado ${room.state}.`);
           return socket.emit('ludoError', { message: 'La sala no está aceptando nuevos jugadores en este momento.' });
      }
      */
      // ▲▲▲ FIN DEL BLOQUE A ELIMINAR/COMENTAR ▲▲▲

      // ¡CLAVE! Si la sala estaba marcada para eliminación, cancelar
      if (room._cleanupScheduled) {
          console.log(`[${roomId}] Jugador ${userId} se ha reconectado. Cancelando eliminación.`);
          delete room._cleanupScheduled;
      }

      socket.join(roomId);

      // Buscar el asiento del jugador por su 'userId' (que es el username)
      let mySeatIndex = room.seats.findIndex(s => s && s.userId === userId);

      let playerName = null; // Variable para guardar el nombre

      if (mySeatIndex === -1) {
          // El jugador no está en esta sala, buscar asiento disponible
          console.log(`[${roomId}] ${userId} (Socket ${socket.id}) buscando asiento disponible...`);

          // ▼▼▼ INICIO DEL BLOQUE REEMPLAZADO ▼▼▼
          // CORRECCIÓN: Usar la misma lógica de asignación que en joinLudoRoom

          // Contar jugadores actuales
          const seatedPlayers = room.seats.filter(s => s !== null);
          const hostSeatIndex = room.settings.hostSeatIndex;

          if (seatedPlayers.length === 1 && room.state === 'waiting') {
              // ¡SOLO HAY UN JUGADOR Y ESTAMOS EN ESPERA! Forzar asiento diagonal.
              const existingPlayerSeatIndex = room.seats.findIndex(s => s !== null);
              const diagonalSeat = (existingPlayerSeatIndex + 2) % 4;

              if (room.seats[diagonalSeat] === null) {
                  console.log(`[${roomId}] (joinLudoGame) Asignación diagonal obligatoria: Jugador 1 en ${existingPlayerSeatIndex}, Jugador 2 asignado a ${diagonalSeat}.`);
                  mySeatIndex = diagonalSeat;
              } else {
                   console.warn(`[${roomId}] (joinLudoGame) Error en lógica diagonal: Se detectó 1 jugador, pero el asiento diagonal ${diagonalSeat} está ocupado.`);
                   // Continuar con la lógica normal...
              }
          }

          // Si la lógica diagonal no se aplicó (o falló), usar la lógica de prioridad normal
          if (mySeatIndex === -1) {
              // 1. Calcular el orden de prioridad de los asientos RELATIVO al host
              const diagonalSeatHost = (hostSeatIndex + 2) % 4;
              const leftSeat = (hostSeatIndex + 1) % 4; // Izquierda del host (sentido horario)
              const rightSeat = (hostSeatIndex + 3) % 4; // Derecha del host (sentido horario)

              // 2. Buscar asiento diagonal (relativo al host)
              if (room.seats[diagonalSeatHost] === null) {
                  mySeatIndex = diagonalSeatHost;
              } 
              // 3. Buscar asiento 'izquierda' (del host)
              else if (room.seats[leftSeat] === null) {
                  mySeatIndex = leftSeat;
              } 
              // 4. Buscar asiento 'derecha' (del host)
              else if (room.seats[rightSeat] === null) {
                  mySeatIndex = rightSeat;
              }
          }

          // 5. Si no hay asientos con prioridad, buscar cualquier asiento disponible
          if (mySeatIndex === -1) {
              for (let i = 0; i < 4; i++) {
                  if (room.seats[i] === null) {
                      mySeatIndex = i;
                      break;
                  }
              }
          }
          // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲

          if (mySeatIndex !== -1) {
              // Asignar asiento disponible
              const assignedColor = room.settings.colorMap[mySeatIndex];
              playerName = userId.replace('user_', ''); // <-- Obtener nombre
              const userInfo = users[playerName.toLowerCase()]; // <-- Obtener info

              // ▼▼▼ ¡AÑADE VALIDACIÓN DE CRÉDITOS AQUÍ! ▼▼▼
              if (room.state === 'post-game') { // Solo si se une a una revancha
                  const bet = parseFloat(room.settings.bet) || 0;
                  const roomCurrency = room.settings.betCurrency || 'USD';
                  if (!userInfo) {
                      console.error(`[JOIN POST-GAME ERROR] No se encontró userInfo para ${playerName}.`);
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

              room.seats[mySeatIndex] = {
                  playerId: socket.id,
                  playerName: playerName, // Usa la variable obtenida
                  avatar: userInfo?.avatar_url || '', // Usa la variable obtenida
                  userId: userId,
                  // ▼▼▼ ASEGÚRATE DE QUE ESTA LÍNEA ESTÉ ASÍ ▼▼▼
                  status: (room.state === 'playing' || room.state === 'waiting') ? 'waiting' : 'playing', // Únete como 'waiting' si el juego está activo o esperando, 'playing' si está en post-game
                  // ▲▲▲ FIN ▲▲▲
                  color: assignedColor
              };
              console.log(`[${roomId}] ${userId} asignado al asiento ${mySeatIndex} (${assignedColor}) con estado ${room.seats[mySeatIndex].status}`);
              playerName = room.seats[mySeatIndex].playerName; // Guardar nombre
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
              ludoIo.to(roomId).emit('rematchUpdate', {
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
      console.log(`[${roomId}] Transmitiendo 'playerJoined' a la sala para sincronizar asientos (en joinLudoGame).`);
      ludoIo.to(roomId).emit('playerJoined', getSanitizedRoomForClient(room));

      // ▼▼▼ ¡AÑADE ESTA LÍNEA! ▼▼▼
      // Notifica a TODOS en el lobby que los asientos de esta sala han cambiado.
      broadcastRoomListUpdate(ludoIo); 
      // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
      // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

      // Actualizar el estado del usuario en la lista global
      const username = userId.replace('user_', '');
      if (username) {
          connectedUsers[socket.id] = {
              username: username,
              status: 'Jugando'
          };
          broadcastUserListUpdate(ludoIo);
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

    // ▼▼▼ AÑADE ESTE NUEVO LISTENER COMPLETO ▼▼▼
    socket.on('ludoStartGame', (data) => {
      const { roomId } = data;
      const room = rooms[roomId];

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
          const userInfo = users[seat.userId.replace('user_', '')];
          if (!userInfo) {
              failedPlayers.push({ name: seat.playerName, reason: 'Información no encontrada.' });
              continue;
          }

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
          const userInfo = users[seat.userId.replace('user_', '')];
          const totalCostInUserCurrency = convertCurrency(totalCostInRoomCurrency, room.settings.betCurrency, userInfo.currency, exchangeRates);

          // 1. Restar créditos
          userInfo.credits -= totalCostInUserCurrency;

          // 2. Sumar al bote (convertido a la moneda de la sala)
          totalPot += totalCostInRoomCurrency;

          // 3. Notificar al jugador su nuevo saldo
          // (Encontramos el socket.id del jugador, que puede haber cambiado)
          const playerSocket = ludoIo.sockets.sockets.get(seat.playerId);
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
      ludoIo.to(roomId).emit('ludoGameStarted', {
          gameState: room.gameState,
          seats: room.seats
      });

      // ▼▼▼ AÑADE ESTA LÍNEA ▼▼▼
      // Notifica a TODOS en el lobby que el estado de esta sala cambió a 'playing'
      broadcastRoomListUpdate(ludoIo);
      // ▲▲▲ FIN DE LA LÍNEA A AÑADIR ▲▲▲
    });
    // ▲▲▲ FIN DEL LISTENER AÑADIDO ▲▲▲

    // ▼▼▼ LÓGICA DE DADOS ACTUALIZADA (CON CÁLCULO DE MOVIMIENTOS) ▼▼▼
    socket.on('ludoRollDice', (data) => {
      try {
      const { roomId } = data;
      const room = rooms[roomId];

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

      const mySeatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
      if (mySeatIndex === -1) return socket.emit('ludoError', { message: 'No estás sentado en esta mesa.' });

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
      ludoIo.to(roomId).emit('ludoDiceRolling', {
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

      const gameType = room.settings?.gameType || 'ludo';
      if (gameType === 'parchis') {
          return handleParchisRoll(room, io, socket, dice1, dice2);
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
              const result = calculatePath(playerColor, piece.position, diceValue, room.gameState.board, room.gameState.pieces, gameType);
                  if (result.finalPosition !== null) {
                      // Aquí podrías añadir la lógica de validación de 'kill moves' si aplica
                      room.gameState.turn.possibleMoves.push({
                          type: 'move_active_piece', pieceId: piece.id, diceValue: diceValue, targetPosition: result.finalPosition
                      });
                  }
              });
               console.log(`[${roomId}] Movimientos posibles con dado ${diceValue}:`, room.gameState.turn.possibleMoves);


              // 2. EMITE 'ludoDiceRolled' INMEDIATAMENTE para detener la animación del cliente
              ludoIo.to(roomId).emit('ludoDiceRolled', {
                  playerId: socket.id,
                  playerName: playerName,
                  diceValues: [dice1, dice2], // Envía los valores reales que salieron
                  isDouble: true,             // Indica que fue un doble
                  turnData: room.gameState.turn // Envía el estado actualizado (canRoll=false, moves=[dado])
              });
               console.log(`[${roomId}] Emitiendo ludoDiceRolled para detener animación (single piece exit).`);

              // 3. Mantiene el setTimeout para actualizar la POSICIÓN VISUAL de la ficha
              setTimeout(() => {
                  if (rooms[roomId] && rooms[roomId].state === 'playing') {
                      console.log(`[${roomId}] Enviando actualización del tablero después del retraso (single piece exit).`);
                      ludoIo.to(roomId).emit('ludoGameStateUpdated', {
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
          ludoIo.to(roomId).emit('ludoDiceRolled', {
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
                  if (rooms[roomId] && rooms[roomId].state === 'playing') {
                      console.log(`[${roomId}] Enviando actualización del tablero después del retraso.`);
                      ludoIo.to(roomId).emit('ludoGameStateUpdated', {
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
                  const { finalPosition } = calculatePath(playerColor, otherPiece.position, otherDie, boardRules, room.gameState.pieces, gameType);
                  if (finalPosition !== null) {
                      return true; // ¡Encontró un movimiento válido!
                  }
              }
              return false; // No se encontró ningún movimiento para el otro dado
          };

          // Función 3: Verifica si una ficha puede llegar a la meta
          const canReachGoal = (piece, diceValue) => {
              const result = calculatePath(playerColor, piece.position, diceValue, boardRules, room.gameState.pieces, gameType);
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
              const result = calculatePath(playerColor, piece.position, dieValue, boardRules, room.gameState.pieces, gameType);

                  if (result.finalPosition !== null) {
                      let isValid = true;
                      // Es un Kill Move?
                      if (isKillMove(result.finalPosition, playerColor)) {
                          // Sí. Comprobar Prerrequisito (Regla 2)
                          // MODIFICACIÓN: Esta regla (no poder matar si no puedes mover el otro dado)
                          // SOLO aplica a LUDO. En Parchís se permite porque el bono de 20 cambia todo.
                          if (gameType !== 'parchis' && !canPlayOtherDie(otherDieValue, piece.id)) {
                              isValid = false; // Inválido en LUDO.
                              console.log(`[${roomId}] RECHAZADO (Regla 2 LUDO): Mover ${piece.id} con ${dieValue} (MATA) pero no se puede jugar ${otherDieValue}`);
                          }
                      }

                      if (isValid) {
                          possibleMoves.push({
                              type: 'move_active_piece', pieceId: piece.id, diceValue: dieValue, targetPosition: result.finalPosition
                          });
                      }
                  }
              });

              // 2. Comprobar movimiento con la SUMA (AHORA INCLUYE DOBLES)
              const sumDice = dice1 + dice2;
              const resultSum = calculatePath(playerColor, piece.position, sumDice, boardRules, room.gameState.pieces, gameType);
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

              const canPlaySum = calculatePath(playerColor, singlePiece.position, sumDice, boardRules, room.gameState.pieces, gameType).finalPosition !== null;
              const canPlayMax = calculatePath(playerColor, singlePiece.position, maxDie, boardRules, room.gameState.pieces, gameType).finalPosition !== null;

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

              ludoIo.to(roomId).emit('ludoDiceRolled', {
                  playerId: socket.id,
                  playerName: playerName,
                  diceValues: [dice1, dice2],
                  isDouble: false,
                  turnData: room.gameState.turn 
              });

              // ▼▼▼ MODIFICA ESTA LÍNEA ▼▼▼
              setTimeout(() => { passTurn(room, io); }, 2200); // 1s anim + 1s espera + 0.2s buffer
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

               ludoIo.to(roomId).emit('ludoDiceRolled', {
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

              ludoIo.to(roomId).emit('ludoDiceRolled', {
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
    socket.on('ludoMovePiece', (data) => {
      try {
      const { roomId, move } = data; // 'move' contendrá { type: 'move_from_base', pieceId: 'yellow-1' }
      const room = rooms[roomId];

      // ▼▼▼ AÑADE ESTE BLOQUE ▼▼▼
      if (room && room.gameState.turn.isMoving) {
          console.warn(`[${roomId}] RECHAZADO: Se recibió un movimiento mientras otro estaba en progreso.`);
          return socket.emit('ludoError', { message: 'Espera a que termine el movimiento anterior.' });
      }
      // ▲▲▲ FIN DEL BLOQUE ▲▲▲

      if (!room) return socket.emit('ludoError', { message: 'Sala no encontrada.' });
      if (room.state !== 'playing') return socket.emit('ludoError', { message: 'El juego no ha comenzado.' });

      const mySeatIndex = room.seats.findIndex(s => s && s.playerId === socket.id);
      if (mySeatIndex === -1) return socket.emit('ludoError', { message: 'No estás sentado.' });
      if (room.gameState.turn.playerIndex !== mySeatIndex) return socket.emit('ludoError', { message: 'No es tu turno.' });

      const seatColor = room.seats[mySeatIndex].color;
      const playerName = room.seats[mySeatIndex].playerName; // <-- AÑADE ESTA LÍNEA
      const turnData = room.gameState.turn;
      const boardRules = room.gameState.board;
      const gameType = room.settings.gameType || 'ludo';
      const playerColor = getControlledColorForSeat(room, mySeatIndex) || seatColor;
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
          precomputedPrizePath = calculatePath(playerColor, prizePiece.position, prizeDistance, boardRules, room.gameState.pieces, gameType);
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
              ludoIo.to(roomId).emit('ludoGameStateUpdated', {
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
                                  const currentRoom = rooms[roomId];
                                  if (currentRoom) {
                                      ludoIo.to(roomId).emit('ludoGameStateUpdated', {
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
               // ▼▼▼ INICIO: VERIFICACIÓN "MATAR ES OBLIGATORIO" (LÓGICA MEJORADA v4) ▼▼▼
              if (gameType !== 'parchis') {
                  const initialPossibleMoves = gameStateRefForTurnStart.turn.possibleMoves || [];
                  const potentialKillMovesAtTurnStart = initialPossibleMoves.filter(move =>
                      move.type === 'move_active_piece' && isKillMove(move.targetPosition, playerColor, gameStateRefForTurnStart.pieces, room.gameState.board)
                  );

                  const mustKill = potentialKillMovesAtTurnStart.length > 0;
                  const chosenMoveIsKill = isKillMove(validMove.targetPosition, playerColor, room.gameState.pieces, room.gameState.board);

                  if (mustKill && !chosenMoveIsKill) {
                      console.log(`[${roomId}] Movimiento no matador (${pieceId} con ${diceValue}). Había matanza(s) posible(s) al inicio.`);

                      const targetKillPositions = [...new Set(potentialKillMovesAtTurnStart.map(m => m.targetPosition))];

                      let killStillPossible = false;
                      const activePiecesNow = playerPiecesList.filter(p => p.state === 'active');

                      if (remainingDice.length > 0) {
                          console.log(`[${roomId}] Verificando si aún se puede matar con dados restantes: [${remainingDice.join(', ')}] hacia [${targetKillPositions.join(', ')}]`);

                          for (const piece of activePiecesNow) {
                              if (piece.id === pieceId) {
                                  console.log(`[${roomId}] Regla 1: Excluyendo ${piece.id} de verificación de matanza.`);
                                  continue;
                              }

                              for (const die of remainingDice) {
                                  const simulatedPath = calculatePath(playerColor, piece.position, die, boardRules, room.gameState.pieces, gameType);
                                  if (simulatedPath.finalPosition !== null && targetKillPositions.includes(simulatedPath.finalPosition)) {
                                      killStillPossible = true;
                                      console.log(`[${roomId}] ✅ AÚN ES POSIBLE MATAR: ${piece.id} (en ${piece.position}) puede llegar a ${simulatedPath.finalPosition} con ${die}.`);
                                      break;
                                  }
                              }
                              if (killStillPossible) break;

                              if (remainingDice.length === 2 && !killStillPossible) {
                                  const sumDie = remainingDice[0] + remainingDice[1];
                                  const simulatedSumPath = calculatePath(playerColor, piece.position, sumDie, boardRules, room.gameState.pieces, gameType);
                                  if (simulatedSumPath.finalPosition !== null && targetKillPositions.includes(simulatedSumPath.finalPosition)) {
                                      killStillPossible = true;
                                      console.log(`[${roomId}] ✅ AÚN ES POSIBLE MATAR: ${piece.id} (en ${piece.position}) puede llegar a ${simulatedSumPath.finalPosition} con la suma ${sumDie}.`);
                                      break;
                                  }
                              }
                              if (killStillPossible) break;
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

                              ludoIo.to(roomId).emit('ludoFoulPenalty', {
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
               // ▲▲▲ FIN: VERIFICACIÓN "MATAR ES OBLIGATORIO" (LÓGICA MEJORADA v4) ▲▲▲

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
                          const { finalPosition: posDie } = calculatePath(playerColor, piece.position, dieValueForced, boardRules, room.gameState.pieces, 'parchis');
                          if (posDie !== null) {
                              turnData.possibleMoves.push({
                                  type: 'move_active_piece', pieceId: piece.id, diceValue: dieValueForced, targetPosition: posDie
                              });
                          }
                          if (sumValueForced !== null) {
                              const { finalPosition: posSum } = calculatePath(playerColor, piece.position, sumValueForced, boardRules, room.gameState.pieces, 'parchis');
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
                  : calculatePath(playerColor, pieceToMove.position, diceValue, boardRules, room.gameState.pieces, gameType);
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

              // ▼▼▼ INICIO DE LA CORRECCIÓN (LÓGICA DE VICTORIA) ▼▼▼

              // b. ¿La ficha llegó a la meta?
              const goalCell = room.gameState.board.goal[playerColor];
              let goalOccurred = false; // <-- AÑADE ESTA LÍNEA
              if (pieceToMove.position === goalCell) {
                  goalOccurred = true; // <-- AÑADE ESTA LÍNEA
                  if (gameType === 'parchis') {
                      turnData.prizeMoves = (turnData.prizeMoves || 0) + 10;
                      turnData.canRollAgain = turnData.canRollAgain || false;
                  } else {
                      turnData.canRollAgain = true; // Guardar el bono en el estado del turno
                  }
                  console.log(`[${roomId}] ¡La ficha ${pieceToMove.id} ha llegado a la meta!`);

                  // c. ¿Ha ganado el jugador?
                  if (checkWinCondition(room, playerColor)) {
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

                      winners.forEach(seatInfo => {
                          if (!seatInfo) return;
                          const winnerUsername = seatInfo.userId ? seatInfo.userId.replace('user_', '') : null;
                          const winnerInfo = winnerUsername ? users[winnerUsername.toLowerCase()] : null;

                          if (winnerInfo) {
                              const winningsInUserCurrency = convertCurrency(winningsPerPlayer, roomCurrency, winnerInfo.currency, exchangeRates);
                              winnerInfo.credits += winningsInUserCurrency;

                              console.log(`[${roomId}] PAGO REALIZADO (Victoria): ${winnerUsername} recibe ${winningsPerPlayer.toFixed(2)} ${roomCurrency} (Equivalente a ${winningsInUserCurrency.toFixed(2)} ${winnerInfo.currency}).`);
                              console.log(`[${roomId}] Saldo anterior: ${(winnerInfo.credits - winningsInUserCurrency).toFixed(2)} ${winnerInfo.currency}. Saldo nuevo: ${winnerInfo.credits.toFixed(2)} ${winnerInfo.currency}.`);

                              const winnerSocket = ludoIo.sockets.sockets.get(seatInfo.playerId);
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
                      });
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
                      ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState,
                          moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
                      });
                      room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO

                      // ▼▼▼ LUEGO ENVIAR EL MODAL DE VICTORIA DESPUÉS DE LA ANIMACIÓN ▼▼▼
                      setTimeout(() => {
                          // Verificar que la sala todavía existe
                          if (!rooms[roomId]) {
                              console.warn(`[${roomId}] Sala eliminada antes de enviar ludoGameOver`);
                              return;
                          }

                          ludoIo.to(roomId).emit('ludoGameOver', {
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
                          broadcastRoomListUpdate(ludoIo);
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
                      const result = calculatePath(playerColor, piece.position, prizeDistance, boardRules, room.gameState.pieces, gameType);
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
                      ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState,
                          moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
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
                        const result = calculatePath(playerColor, piece.position, remainingDie, boardRules, room.gameState.pieces, gameType);
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
                          ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                               newGameState: room.gameState,
                               moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
                          });
                          room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                          return; // Salir, NO pasar turno

                     } else { // No había bono, y no hay movimientos -> Pasar turno (salvo premio pendiente)
                          const hasPendingPrize = (gameType === 'parchis' && (turnData.prizeMoves || 0) > 0);
                          if (!hasPendingPrize) {
                              console.log(`[${roomId}] No hay movimientos para el dado restante ${turnData.moves[0]}. Pasando turno...`);
                              ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                                  newGameState: room.gameState,
                                  moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
                              });
                              room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO
                              setTimeout(() => passTurn(room, io), 1000); // 1s de retraso
                              return; // Salimos de la función
                          } else {
                              console.log(`[${roomId}] Premio pendiente tras dado sin movimiento. Manteniendo turno para ${playerName}.`);
                              ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                                  newGameState: room.gameState,
                                  moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
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
                      ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                          newGameState: room.gameState,
                          moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
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
                   ludoIo.to(roomId).emit('ludoGameStateUpdated', {
                        newGameState: room.gameState,
                        moveInfo: { ...move, playerColor, startPosition, newPosition: validMove.targetPosition, movePath }
                   });
                   room.gameState.turn.isMoving = false; // LIBERA EL BLOQUEO

                  const hasPendingPrize = (gameType === 'parchis' && (turnData.prizeMoves || 0) > 0);
                  // Si NO hay bono ni premio pendiente, pasar el turno
                  if (!hasBonus && !hasPendingPrize) {
                     console.log(`[${roomId}] ${playerName} usó todos los dados. Pasando turno...`);
                     setTimeout(() => passTurn(room, io), 2200); // 1s anim + 1s espera + 0.2s buffer
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

    });
    // ▲▲▲ FIN DEL LISTENER DE MOVIMIENTO ▲▲▲

    socket.on('sendLudoGameChat', (data) => {
      const { roomId, text, sender } = data;
      ludoIo.to(roomId).emit('gameChatUpdate', { sender, text, ts: Date.now() });
    });

    // Escucha el evento del botón "Volver al Lobby"
    socket.on('leaveGame', (data) => {
      const { roomId } = data || {};
      console.log(`[LeaveGame] Jugador ${socket.id} ha hecho clic en "Volver al Lobby" para la sala ${roomId}.`);
      if (roomId && rooms[roomId]) {
          handlePlayerDeparture(roomId, socket.id, ludoIo);
      }
    });

    // ▼▼▼ SISTEMA DE REVANCHA ▼▼▼
    socket.on('confirmRematch', (data) => {
      const receivedRoomId = data?.roomId;
      console.log(`\n--- [REMATCH SERVER] Recibido 'confirmRematch' ---`);
      console.log(`  - Socket ID: ${socket.id}`);
      console.log(`  - Room ID recibido: ${receivedRoomId}`);
      console.log(`  - Salas existentes AHORA: [${Object.keys(rooms).join(', ')}]`);
      console.log(`--- FIN LOG DETALLADO ---\n`);

      const { roomId } = data;
      const room = rooms[roomId];

      if (!room || !room.rematchData) {
        console.error(`[REMATCH SERVER ERROR] Sala ${roomId} o rematchData no encontrado.`);
        return socket.emit('rematchError', { message: 'No hay revancha disponible.' });
      }

      let playerName = null;
      const playerSeat = room.seats.find(s => s && s.playerId === socket.id);
      if (playerSeat) {
          playerName = playerSeat.playerName;
          console.log(`[REMATCH SERVER] Nombre encontrado en asientos: ${playerName}`);
      } else {
          // Fallback (menos fiable) si no se encontró en asientos
          playerName = connectedUsers[socket.id]?.username;
          console.warn(`[REMATCH SERVER] No se encontró ${socket.id} en asientos, usando connectedUsers: ${playerName}`);
      }
      if (!playerName) {
        console.error(`[REMATCH SERVER ERROR] No se pudo identificar al jugador para socket ${socket.id}.`);
        return socket.emit('rematchError', { message: 'Usuario no identificado.' });
      }

      // ▼▼▼ VALIDACIÓN DE CRÉDITOS PARA REVANCHA ▼▼▼
      // Usa la apuesta y moneda de la sala; verifica el saldo del usuario
      try {
          const userInfoForRematch = users[playerName.toLowerCase()];
          const roomBet = parseFloat(room.settings.bet) || 0;
          const roomCurrency = room.settings.betCurrency || 'USD';

          if (!userInfoForRematch) {
              console.error(`[REMATCH CREDIT CHECK ERROR] No se encontró userInfo para ${playerName}.`);
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

      ludoIo.to(roomId).emit('rematchUpdate', {
        confirmedPlayers: room.rematchData.confirmedPlayers,
        canStart: room.rematchData.canStart,
        winnerName: room.rematchData.winnerName,
        totalPlayers: expectedPlayers
      });
    });

    socket.on('startRematch', (data) => {
      const { roomId } = data;
      const room = rooms[roomId];

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

      // ▼▼▼ ¡MODIFICACIÓN CLAVE! Mover y añadir logs ▼▼▼
      console.log(`[${roomId}] Iniciando revancha por ${room.rematchData.winnerName}. Estado ANTES: ${room.state}`);
      room.state = 'playing'; // <-- ASEGÚRATE DE QUE ESTÉ AQUÍ Y SEA 'playing'
      console.log(`[${roomId}] Estado DESPUÉS: ${room.state}`);
      // ▲▲▲ FIN MODIFICACIÓN ▲▲▲

      delete room.allowRematchConfirmation; // Limpia la bandera

      // ▼▼▼ DÉBITO DE CRÉDITOS Y ACTUALIZACIÓN DEL BOTE ▼▼▼
      let newPot = 0;
      const rebuyBet = parseFloat(room.settings.bet) || 0;
      const rebuyCurrency = room.settings.betCurrency || 'USD';
      const playersToCharge = [...(room.rematchData?.confirmedPlayers || [])];
      const gameType = room.settings.gameType || 'ludo';
      const isGroupsMode = gameType === 'parchis' && room.settings.parchisMode === '4-groups';

      console.log(`[REMATCH START] Debitando ${rebuyBet} ${rebuyCurrency} a jugadores confirmados: [${playersToCharge.join(', ')}]`);

      playersToCharge.forEach(pName => {
          const userInfoCharge = users[pName.toLowerCase()];
          if (userInfoCharge) {
              const costInUserCurrency = convertCurrency(rebuyBet, rebuyCurrency, userInfoCharge.currency, exchangeRates);
              userInfoCharge.credits = Math.max(0, userInfoCharge.credits - costInUserCurrency);
              newPot += rebuyBet;

              const playerSeatRef = room.seats.find(s => s && s.playerName === pName);
              if (playerSeatRef && playerSeatRef.playerId) {
                  const ps = ludoIo.sockets.sockets.get(playerSeatRef.playerId);
                  if (ps) {
                      ps.emit('userStateUpdated', { credits: userInfoCharge.credits, currency: userInfoCharge.currency });
                      console.log(`   - Notificado ${pName} (Socket ${playerSeatRef.playerId}), nuevo saldo: ${userInfoCharge.credits.toFixed(2)} ${userInfoCharge.currency}`);
                  }
              }
          } else {
              console.warn(`[REMATCH START] No se encontró userInfo para ${pName} al debitar créditos.`);
          }
      });
      console.log(`[REMATCH START] Débito completado. Nuevo bote: ${newPot} ${rebuyCurrency}`);
      // ▲▲▲ FIN DÉBITO ▲▲▲

      // ▼▼▼ AÑADE ESTE BLOQUE COMPLETO ▼▼▼

      // --- INICIO: LÓGICA DE RE-ASIGNACIÓN DIAGONAL PARA 2 JUGADORES EN REVANCHA ---

      // Usamos la lista de jugadores que pagaron (los confirmados)
      const confirmedPlayerNames = playersToCharge;

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
      // --- FIN: LÓGICA DE RE-ASIGNACIÓN DIAGONAL ---

  // ▲▲▲ FIN DEL BLOQUE A AÑADIR ▲▲▲

      // ▼▼▼ REINICIAR JUEGO CON MISMA CONFIGURACIÓN ▼▼▼
      const pieceCount = room.settings.pieceCount || 4;

      // Reinicializar fichas
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

      // Reinicializar estado del juego
      room.state = 'playing';
      room.gameState.pot = newPot;
      room.gameState.turn = {
        playerIndex: -1,
        canRoll: true,
        dice: [0, 0],
        moves: [],
        doublesCount: 0,
        isMoving: false
      };
      room.gameState.pieces = initialPieces;

      // ▼▼▼ INICIO DEL BLOQUE REEMPLAZADO ▼▼▼

      // ▼▼▼ INICIO DE LA MODIFICACIÓN (Lógica de Estado de Espera) ▼▼▼

      console.log(`[${roomId}] Jugadores confirmados que jugarán: [${confirmedPlayerNames.join(', ')}]`);

      // Resetear estado de los jugadores PARA LA REVANCHA
      room.seats.forEach((seat, index) => { // <-- Añadido 'index'
        if (seat) {
          if (confirmedPlayerNames.includes(seat.playerName) && room.seats[index] !== null) {
              // SÍ confirmó y pagó: Juega la partida en SU MISMO ASIENTO
              seat.status = 'playing';
              console.log(`   - ${seat.playerName} (Asiento ${index}) confirmado. Mantiene posición.`);
          } else {
              // NO confirmó/pagó: liberamos el asiento completamente
              console.log(`   - ${seat.playerName} (Asiento ${index}) NO confirmó/pagó. Liberando asiento.`);
              room.seats[index] = null;
          }
        }
      });
      // Log de confirmación
      console.log(`[${roomId}] Estado de asientos reseteado para la revancha (con lógica de espera).`);

      // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲
  // ▲▲▲ FIN DEL BLOQUE REEMPLAZADO ▲▲▲

      // ▼▼▼ ¡AÑADE ESTE BLOQUE AQUÍ! ▼▼▼
      // Asignar el primer turno al ganador (nuevo anfitrión)
      const winnerSeatIndex = room.seats.findIndex(s => s && s.playerId === room.rematchData.winnerId);
      if (winnerSeatIndex !== -1) {
          room.gameState.turn.playerIndex = winnerSeatIndex;
          room.gameState.turn.canRoll = true; // El ganador puede lanzar primero
          console.log(`[${roomId}] Revancha: Primer turno asignado a ${room.rematchData.winnerName} (Asiento ${winnerSeatIndex})`);
      } else {
          // Fallback si el ganador no se encuentra (no debería pasar)
          room.gameState.turn.playerIndex = 0; // Por defecto, asiento 0
          room.gameState.turn.canRoll = true;
          console.warn(`[${roomId}] Revancha: No se encontró al ganador en los asientos. Asignando turno a asiento 0.`);
      }
      // ▲▲▲ FIN DEL BLOQUE ▲▲▲

      delete room.rematchData; // Limpiar datos de revancha (esta línea ya existe)

      // ▼▼▼ ¡AÑADE ESTE NUEVO EVENTO ANTES DE 'rematchStarted'! ▼▼▼
      console.log(`[${roomId}] Emitiendo ludoResetBoard a todos los clientes.`);
      ludoIo.to(roomId).emit('ludoResetBoard');
      // ▲▲▲ FIN NUEVO EVENTO ▲▲▲

      // Notificar inicio de revancha (AHORA con state: 'playing' y turno asignado)
      ludoIo.to(roomId).emit('rematchStarted', {
        message: 'Nueva partida iniciada',
        gameState: room.gameState, // Ahora incluye el turno inicial correcto
        seats: room.seats
      });

      // Actualizar lista de salas
      broadcastRoomListUpdate(ludoIo);
    });
    // ▲▲▲ FIN SISTEMA DE REVANCHA ▲▲▲

    // --- DESCONEXIÓN ---

    socket.on('disconnect', () => {
      console.log(`❌ Un jugador se ha desconectado: ${socket.id}`);

      if (connectedUsers[socket.id]) {
          console.log(`Usuario desconectado: ${connectedUsers[socket.id].name}`);
          delete connectedUsers[socket.id];
          broadcastUserListUpdate(ludoIo);
      }

      if (socket.currentRoomId) {
          handlePlayerDeparture(socket.currentRoomId, socket.id, ludoIo);
      }
    });

  }); // Cierre de ludoIo.on('connection')
}

module.exports = { initLudoEngine };

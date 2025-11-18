# JuegoLa51
Juego de cartas La 51 - Un juego de cartas tradicional colombiano

## Descripción
JuegoLa51 es una implementación web del juego de cartas tradicional colombiano "La 51". Es un juego multijugador en tiempo real desarrollado con Node.js, Socket.IO y PostgreSQL.

## Características
- ✅ Juego multijugador en tiempo real
- ✅ Sistema de chat en lobby y partidas
- ✅ Sistema de avatares con recorte de imagen
- ✅ Cálculo de comisiones en COP
- ✅ Mesas de práctica
- ✅ Panel de administración
- ✅ Sistema de monedas múltiples (USD, EUR, COP)
- ✅ Base de datos PostgreSQL

## Instalación
1. Clona el repositorio:
```bash
git clone https://github.com/angelohh18/Juegola51.git
cd Juegola51
```

2. Instala las dependencias:
```bash
npm install
```

3. Configura las variables de entorno:
```bash
export DATABASE_URL="postgresql://usuario:password@host:puerto/database"
```

4. Inicia el servidor:
```bash
npm start
```

## Tecnologías utilizadas
- **Backend**: Node.js, Express, Socket.IO
- **Base de datos**: PostgreSQL
- **Frontend**: HTML5, CSS3, JavaScript
- **Tiempo real**: WebSockets

## Estructura del proyecto
```
JuegoLa51/
├── server.js          # Servidor principal
├── game.js           # Lógica del cliente
├── index.html        # Interfaz principal
├── admin.html        # Panel de administración
├── style.css         # Estilos CSS
├── package.json      # Dependencias
└── README.md         # Documentación
```

## Contribuir
Las contribuciones son bienvenidas. Por favor, abre un issue o pull request.

## Licencia
MIT License# Optimización anti-parpadeo - Thu Oct 16 18:54:30 WEST 2025

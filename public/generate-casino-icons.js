const fs = require('fs');
const path = require('path');

// Check if sharp is available, if not install it: npm install sharp
let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.error('❌ Error: sharp no está instalado. Ejecuta: npm install sharp');
    process.exit(1);
}

async function generateIcon(size, outputPath) {
    const padding = size * 0.15; // 15% padding
    const textArea = size - (padding * 2);
    
    // SVG con el texto "Angelohh Casino"
    const fontSize = Math.floor(size * 0.12); // Ajuste del tamaño de fuente
    const lineHeight = fontSize * 1.2;
    
    const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#211e18;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#2a2620;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.5"/>
    </filter>
  </defs>
  
  <!-- Fondo con gradiente -->
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="url(#bgGradient)"/>
  
  <!-- Borde dorado -->
  <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${size * 0.14}" 
        fill="none" stroke="#c5a56a" stroke-width="4"/>
  
  <!-- Texto principal -->
  <text x="${size / 2}" y="${size / 2 - fontSize * 0.3}" 
        font-family="Georgia, serif" 
        font-size="${fontSize}" 
        font-weight="bold" 
        fill="#c5a56a" 
        text-anchor="middle" 
        filter="url(#shadow)">
    Angelohh
  </text>
  
  <!-- Texto secundario -->
  <text x="${size / 2}" y="${size / 2 + fontSize * 0.8}" 
        font-family="Georgia, serif" 
        font-size="${fontSize * 0.7}" 
        font-weight="bold" 
        fill="#e0d3b6" 
        text-anchor="middle" 
        filter="url(#shadow)">
    Casino
  </text>
  
  <!-- Efecto de brillo -->
  <ellipse cx="${size / 2}" cy="${size * 0.3}" rx="${size * 0.25}" ry="${size * 0.1}" 
           fill="#c5a56a" opacity="0.2"/>
</svg>`;

    try {
        const svgBuffer = Buffer.from(svg);
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        console.log(`✅ ${outputPath} generado exitosamente (${size}x${size})`);
    } catch (error) {
        console.error(`❌ Error generando ${outputPath}:`, error.message);
    }
}

async function generateAllIcons() {
    console.log('🎰 Generando iconos de Angelohh Casino...\n');
    
    const outputDir = path.join(__dirname);
    const iconSizes = [
        { size: 144, file: 'icon-144.png' },
        { size: 192, file: 'icon-192.png' },
        { size: 512, file: 'icon-512.png' }
    ];
    
    for (const icon of iconSizes) {
        const outputPath = path.join(outputDir, icon.file);
        await generateIcon(icon.size, outputPath);
    }
    
    console.log('\n🎉 Todos los iconos de Angelohh Casino han sido generados');
    console.log('📱 Los iconos están listos para la PWA');
}

generateAllIcons().catch(console.error);


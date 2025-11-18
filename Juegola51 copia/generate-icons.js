const fs = require('fs');
const sharp = require('sharp');

async function generateIcons() {
    console.log('Generando iconos PNG desde SVG...');
    
    const iconSizes = [
        { svg: 'icon-192.svg', png: 'icon-192.png', size: 192 },
        { svg: 'icon-512.svg', png: 'icon-512.png', size: 512 },
        { svg: 'icon-144.svg', png: 'icon-144.png', size: 144 }
    ];
    
    for (const icon of iconSizes) {
        try {
            const svgBuffer = fs.readFileSync(icon.svg);
            await sharp(svgBuffer)
                .resize(icon.size, icon.size)
                .png()
                .toFile(icon.png);
            console.log(`✅ ${icon.png} generado exitosamente`);
        } catch (error) {
            console.error(`❌ Error generando ${icon.png}:`, error.message);
        }
    }
    
    console.log('🎉 Todos los iconos han sido generados');
}

generateIcons();


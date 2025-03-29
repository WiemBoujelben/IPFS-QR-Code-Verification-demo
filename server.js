import express from 'express';
import fileUpload from 'express-fileupload';
import { create } from 'ipfs-core';
import jsQR from 'jsqr';
import sharp from 'sharp';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import QRCodeGenerator from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(fileUpload());
app.use(express.static('public'));

// IPFS instance management
let ipfsInstance = null;

async function getIpfs() {
    if (!ipfsInstance) {
        ipfsInstance = await create({
            repo: join(__dirname, 'ipfs-repo'),
            start: true
        });
    }
    return ipfsInstance;
}

// Generate QR Code Endpoint (unchanged)
app.post('/generate', async (req, res) => {
    try {
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No data provided in request body' 
            });
        }

        const ipfs = await getIpfs();
        const { cid } = await ipfs.add(JSON.stringify(req.body));
        const cidString = cid.toString();
        
        await fs.ensureDir(join(__dirname, 'public', 'qrcodes'));
        const qrPath = join(__dirname, 'public', 'qrcodes', `qr-${cidString}.png`);
        
        await QRCodeGenerator.toFile(qrPath, `ipfs://${cidString}`);
        
        res.json({
            success: true,
            cid: cidString,
            qrUrl: `/qrcodes/qr-${cidString}.png`
        });
    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// New Verify Endpoint using jsQR
app.post('/verify', async (req, res) => {
    try {
        if (!req.files || !req.files.qrImage) {
            return res.status(400).json({ 
                success: false, 
                error: 'No QR code image uploaded' 
            });
        }

        // Process image with sharp
        const imageBuffer = req.files.qrImage.data;
        const { data, info } = await sharp(imageBuffer)
            .ensureAlpha() // Ensure we have an alpha channel
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Convert to Uint8ClampedArray as required by jsQR
        const uint8Array = new Uint8ClampedArray(data.buffer);
        
        // Decode QR code
        const decoded = jsQR(uint8Array, info.width, info.height);
        
        if (!decoded) {
            throw new Error('Could not decode QR code from image');
        }

        const cid = decoded.data.replace('ipfs://', '');
        
        // Fetch data from IPFS
        const ipfs = await getIpfs();
        try {
            const chunks = [];
            for await (const chunk of ipfs.cat(cid)) {
                chunks.push(chunk);
            }
            const data = JSON.parse(Buffer.concat(chunks).toString());
            
            res.json({
                success: true,
                cid,
                data
            });
        } catch (ipfsError) {
            res.status(404).json({
                success: false,
                error: 'Data not found on IPFS',
                cid
            });
        }
    } catch (error) {
        console.error('Verification failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message.includes('decode') 
                ? 'Failed to decode QR code. Please ensure you uploaded a valid QR code image.'
                : error.message
        });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
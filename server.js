import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
    console.warn('Warning: OPENAI_API_KEY is not set. API requests will fail until it is configured.');
}

const ai = new OpenAI({ apiKey });
const DEFAULT_MODEL = 'gpt-4.1-mini';

const extractResponseText = (response) => {
    if (response?.output && Array.isArray(response.output)) {
        const compiled = response.output.map((item) => {
            if (!item?.content || !Array.isArray(item.content)) return '';
            return item.content.map((contentItem) => {
                if (typeof contentItem?.text === 'string') return contentItem.text;
                if (Array.isArray(contentItem?.text)) {
                    return contentItem.text.map((part) => part?.text ?? part?.value ?? '').join('');
                }
                if (contentItem?.text?.value) return contentItem.text.value;
                return '';
            }).join('');
        }).join('').trim();
        if (compiled) return compiled;
    }

    const fallback = response?.output_text;
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
    if (Array.isArray(fallback)) {
        const joined = fallback.join('').trim();
        if (joined) return joined;
    }
    throw new Error('OpenAI did not return any text output.');
};

const ensureNoAdditionalProperties = (schema) => {
    if (schema === null || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(ensureNoAdditionalProperties);

    const clone = { ...schema };
    if (clone.type === 'object') {
        if (!('additionalProperties' in clone)) {
            clone.additionalProperties = false;
        }
        if (clone.properties && typeof clone.properties === 'object') {
            clone.properties = Object.fromEntries(
                Object.entries(clone.properties).map(([key, value]) => [key, ensureNoAdditionalProperties(value)])
            );
        }
    }

    if (clone.type === 'array' && clone.items) {
        clone.items = ensureNoAdditionalProperties(clone.items);
    }

    return clone;
};

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
});

app.post('/api/json-prompt', async (req, res) => {
    const { prompt, schema, schemaName, model } = req.body || {};
    if (!prompt || !schema || !schemaName) {
        return res.status(400).json({ error: 'Missing required fields: prompt, schema, and schemaName.' });
    }
    if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    try {
        const preparedSchema = ensureNoAdditionalProperties(schema);
        const response = await ai.responses.create({
            model: model || DEFAULT_MODEL,
            input: prompt,
            text: {
                format: {
                    type: 'json_schema',
                    name: schemaName,
                    schema: preparedSchema,
                    strict: true,
                },
            },
        });

        const responseText = extractResponseText(response);
        res.json({ result: JSON.parse(responseText) });
    } catch (error) {
        console.error('Failed to fulfill AI request:', error);
        const status = error?.status || 500;
        res.status(status).json({ error: error?.message || 'Failed to generate content.' });
    }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
    console.log(`API server ready on http://localhost:${port}`);
});

// SqualoMail proxy to avoid CORS issues
app.post('/api/squalomail/create-newsletter', async (req, res) => {
    try {
        const response = await fetch('https://api.squalomail.com/v1/create-newsletter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('SqualoMail proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/squalomail/schedule-newsletter', async (req, res) => {
    try {
        const params = new URLSearchParams(req.body);
        const response = await fetch('https://api.squalomail.com/v1/schedule-newsletter?' + params.toString(), {
            method: 'POST',
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('SqualoMail schedule proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/squalomail/send-newsletter', async (req, res) => {
    try {
        const params = new URLSearchParams(req.query);
        const response = await fetch('https://api.squalomail.com/v1/send-newsletter?' + params.toString(), {
            method: 'GET',
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('SqualoMail send proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

import { spawn, ChildProcess } from 'child_process';
import readline from 'readline';
import { randomUUID } from 'crypto';
import { logger } from '../../config/logger.js';
import { RAG_CONFIG } from '../../config/constants.js';

export class EmbeddingService {
  private process: ChildProcess;
  private rl: readline.Interface;
  private pending = new Map<string, (embedding: Float32Array) => void>();

  constructor() {
    this.process = spawn('python3', ['scripts/embed_service.py'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.rl = readline.createInterface({ input: this.process.stdout! });

    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'embedding') {
          const resolve = this.pending.get(msg.id);
          if (resolve) {
            const binary = Buffer.from(msg.data, 'base64');
            const floatArray = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
            resolve(floatArray);
            this.pending.delete(msg.id);
          }
        }
      } catch (e) {
        logger.error({ err: e }, 'Embedding parse error');
      }
    });

    this.process.stderr?.on('data', (data) => {
      logger.debug({ data: data.toString() }, 'Embedding stderr');
    });
  }

  async embed(text: string): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Embedding timeout'));
      }, 10000);

      this.pending.set(id, (embedding: Float32Array) => {
        clearTimeout(timeout);
        resolve(embedding);
      });

      this.process.stdin!.write(JSON.stringify({ type: 'embed', text, id }) + '\n');
    });
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Embedding batch timeout'));
      }, 30000);

      this.process.stdin!.write(
        JSON.stringify({
          type: 'embed_batch',
          texts: texts.map((t, i) => ({ text: t, id: `${id}-${i}` })),
        }) + '\n'
      );

      setTimeout(() => {
        reject(new Error('Embedding batch timeout'));
      }, 30000);
    });
  }

  close() {
    this.process.kill();
    this.rl.close();
  }
}

let embedder: EmbeddingService;

export function getEmbedder(): EmbeddingService {
  if (!embedder) {
    embedder = new EmbeddingService();
  }
  return embedder;
}

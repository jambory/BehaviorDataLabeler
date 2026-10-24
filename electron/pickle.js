// A deliberately data-only subset of Python pickle. Never executes pickle globals.
// Output: protocol 2, dict[int, list[str]], compatible with Python pickle.load.
export function encodeLabels(labels) {
  const chunks = [Buffer.from([0x80, 2, 0x7d, 0x28])];
  labels.forEach((names, frame) => {
    const key = Buffer.alloc(5); key[0] = 0x4a; key.writeInt32LE(frame, 1);
    chunks.push(key, Buffer.from([0x5d, 0x28]));
    for (const name of names) {
      const str = Buffer.from(name, 'utf8'), header = Buffer.alloc(5);
      header[0] = 0x58; header.writeUInt32LE(str.length, 1); chunks.push(header, str);
    }
    chunks.push(Buffer.from([0x65]));
  });
  chunks.push(Buffer.from([0x75, 0x2e]));
  return Buffer.concat(chunks);
}
export function decodeLabels(data) {
  let p = 0, nextMemo = 0;
  const stack = [], memo = new Map(), MARK = Symbol('mark');
  const read = n => { if (p+n > data.length) throw new Error('Truncated pickle.'); const b = data.subarray(p,p+n); p+=n; return b; };
  const uint = n => n === 1 ? read(1)[0] : n === 2 ? read(2).readUInt16LE() : read(4).readUInt32LE();
  const tail = () => { const idx = stack.lastIndexOf(MARK); if (idx < 0) throw new Error('Invalid pickle stack.'); return stack.splice(idx).slice(1); };
  while (p < data.length) {
    const op = read(1)[0];
    switch(op) {
      case 0x80: { const v=uint(1); if (v<2 || v>5) throw new Error('Supported pickle protocols: 2–5.'); break; }
      case 0x95: read(8); break;
      case 0x7d: stack.push(new Map()); break;
      case 0x5d: stack.push([]); break;
      case 0x28: stack.push(MARK); break;
      case 0x4b: stack.push(uint(1)); break;
      case 0x4d: stack.push(uint(2)); break;
      case 0x4a: stack.push(read(4).readInt32LE()); break;
      case 0x58: stack.push(read(uint(4)).toString('utf8')); break;
      case 0x8c: stack.push(read(uint(1)).toString('utf8')); break;
      case 0x94: memo.set(nextMemo++, stack.at(-1)); break;
      case 0x71: { const i=uint(1); memo.set(i,stack.at(-1)); nextMemo=Math.max(nextMemo,i+1); break; }
      case 0x72: { const i=uint(4); memo.set(i,stack.at(-1)); nextMemo=Math.max(nextMemo,i+1); break; }
      case 0x68: case 0x6a: { const i=uint(op === 0x68 ? 1 : 4); if (!memo.has(i)) throw new Error('Invalid pickle reference.'); stack.push(memo.get(i)); break; }
      case 0x61: { const x=stack.pop(); if (!Array.isArray(stack.at(-1))) throw new Error('Invalid list.'); stack.at(-1).push(x); break; }
      case 0x65: { const items=tail(); if (!Array.isArray(stack.at(-1))) throw new Error('Invalid list.'); stack.at(-1).push(...items); break; }
      case 0x73: { const v=stack.pop(),k=stack.pop(); if (!(stack.at(-1) instanceof Map)) throw new Error('Invalid dict.'); stack.at(-1).set(k,v); break; }
      case 0x75: { const items=tail(), d=stack.at(-1); if (!(d instanceof Map) || items.length%2) throw new Error('Invalid dict.'); for(let i=0;i<items.length;i+=2) d.set(items[i],items[i+1]); break; }
      case 0x2e: {
        const result=stack[0];
        if (stack.length!==1 || !(result instanceof Map)) throw new Error('Expected a frame dictionary.');
        for(const [k,v] of result) if (!Number.isInteger(k)||k<0||!Array.isArray(v)||v.some(x=>typeof x!=='string')) throw new Error('Expected integer frame keys and lists of behavior strings.');
        return result;
      }
      default: throw new Error(`Unsupported pickle opcode 0x${op.toString(16)}. Only plain frame-label dictionaries are accepted.`);
    }
  }
  throw new Error('Incomplete pickle.');
}

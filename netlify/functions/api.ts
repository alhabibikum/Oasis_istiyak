import { createServer } from "../../server";

const app = createServer();

// Netlify serverless function handler
export default async (req: any, context: any) => {
  return new Promise((resolve) => {
    try {
      // Parse request body if it exists
      let body = "";
      if (req.body) {
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }

      // Collect response chunks
      const responseChunks: Buffer[] = [];
      let responseResolved = false;

      // Create Express-compatible request
      const expressReq = {
        method: req.httpMethod || "GET",
        url: req.rawUrl || req.path || "/",
        headers: req.headers || {},
        body: body ? (typeof body === "string" ? (() => { try { return JSON.parse(body); } catch { return body; } })() : body) : {},
        query: req.queryStringParameters || {},
        params: {},
        rawBody: body,
        on: (event: string, handler: Function) => {
          if (event === "data" && body) handler(Buffer.from(body));
          if (event === "end") handler();
        },
        once: (event: string, handler: Function) => {
          if (event === "end") handler();
        },
      };

      // Create Express-compatible response
      const expressRes = {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        statusMessage: "OK",
        _ended: false,
        
        write: (chunk: any) => {
          responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        },

        end: (chunk?: any) => {
          if (expressRes._ended || responseResolved) return;
          expressRes._ended = true;
          
          if (chunk) {
            responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = Buffer.concat(responseChunks).toString("utf-8");
          responseResolved = true;
          resolve({
            statusCode: expressRes.statusCode,
            headers: expressRes.headers,
            body: body || "",
          });
        },

        json: (data: any) => {
          if (expressRes._ended || responseResolved) return;
          expressRes.setHeader("Content-Type", "application/json");
          const jsonStr = JSON.stringify(data);
          responseChunks.push(Buffer.from(jsonStr));
          expressRes.end();
        },

        status: (code: number) => {
          expressRes.statusCode = code;
          return expressRes;
        },

        setHeader: (name: string, value: string) => {
          expressRes.headers[name.toLowerCase()] = value;
          return expressRes;
        },

        send: (data: any) => {
          if (expressRes._ended || responseResolved) return;
          if (typeof data === "object") {
            expressRes.json(data);
          } else {
            responseChunks.push(Buffer.from(String(data)));
            expressRes.end();
          }
        },
      };

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        if (!responseResolved) {
          responseResolved = true;
          resolve({
            statusCode: 504,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Function timeout" }),
          });
        }
      }, 25000); // 25 second timeout

      // Call Express app
      app(expressReq as any, expressRes as any, (err: any) => {
        clearTimeout(timeout);
        if (err && !responseResolved) {
          console.error("API Handler Error:", err);
          responseResolved = true;
          expressRes.statusCode = 500;
          expressRes.json({ error: "Internal Server Error", message: err.message });
        }
      });
    } catch (error: any) {
      console.error("Netlify Function Error:", error);
      resolve({
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Internal Server Error", message: error.message }),
      });
    }
  });
};

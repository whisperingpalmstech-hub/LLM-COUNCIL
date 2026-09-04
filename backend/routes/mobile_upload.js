import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { id, now } from "../db/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "../../data/uploads");

export function createMobileUploadRouter({ db, events, env = process.env }) {
  const router = express.Router();

  // Helper to get local IP address
  router.get("/ip", (req, res) => {
    const interfaces = os.networkInterfaces();
    let localIp = "localhost";
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
      if (localIp !== "localhost") break;
    }
    const publicBaseUrl = String(env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
    res.json({ ip: localIp, publicBaseUrl });
  });

  router.post("/upload", async (req, res, next) => {
    try {
      const { sessionId, fileName, fileType, fileData, text } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required" });
      }
      if (!db.prepare("select id from sessions where id = ?").get(sessionId)) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      let fileUrl = null;
      let textContent = text || "";

      if (fileData) {
        const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          return res.status(400).json({ error: "Invalid base64 file data" });
        }

        const buffer = Buffer.from(matches[2], "base64");
        if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: "File exceeds the 8 MB upload limit" });
        const safeName = `${id()}-${safeFileName(fileName)}`;
        const filePath = path.join(uploadDir, safeName);
        
        fs.writeFileSync(filePath, buffer);
        fileUrl = `/uploads/${safeName}`;
        console.log(`[Mobile Bridge] Saved uploaded file to: ${filePath}`);
        
        if (!textContent) {
          textContent = `Uploaded file: ${fileName || "document"} (${fileType || "unknown"})`;
        }
      }

      // Add message to the database as a round 0 system message or user context
      const messageId = id();
      const payload = {
        shortSummary: textContent,
        keyClaims: fileUrl ? [`Attached file: ${fileUrl}`] : [],
        confidence: 1.0,
        fileUrl,
        fileType,
        compact: false
      };

      db.prepare(`insert into messages(id, session_id, role_id, round_number, model_name, compact, payload, content, created_at) values(?,?,?,?,?,?,?,?,?)`)
        .run(messageId, sessionId, null, 0, "mobile-upload", 0, JSON.stringify(payload), textContent, now());

      // Emit event so the SSE stream sends it to the frontend
      events.emit("ROLE_MESSAGE", { 
        eventId: id(), 
        eventType: "ROLE_MESSAGE",
        occurredAt: now(),
        sessionId, 
        roleId: null, 
        roundNumber: 0, 
        confidence: 1.0 
      });

      console.log(`[Mobile Bridge] Successfully processed mobile upload for session: ${sessionId}`);
      res.json({ success: true, message: "Upload processed", fileUrl });
    } catch (error) {
      console.error("[Mobile Bridge] Error handling upload:", error);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  return router;
}

function safeFileName(value) {
  return path.basename(String(value || "upload")).replace(/[^a-z0-9._-]/gi, "_").slice(0, 120) || "upload";
}

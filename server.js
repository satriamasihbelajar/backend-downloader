import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return [
      "tiktok.com",
      "instagram.com"
    ].some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function ensureIgCookies() {
  const raw = process.env.IG_COOKIES_B64;
  if (!raw) return null;

  const dir = "/app/cookies";
  const file = path.join(dir, "instagram.txt");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(raw, "base64").toString("utf8"));

  return file;
}

async function runYtDlp(args) {
  const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
    maxBuffer: 50 * 1024 * 1024,
  });
  return { stdout, stderr };
}

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.post("/api/info", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !isAllowedUrl(url)) {
      return res.status(400).json({
        ok: false,
        error: "URL tidak valid. Hanya TikTok dan Instagram dulu."
      });
    }

    const cookiesFile = ensureIgCookies();

    const args = [
      ...(cookiesFile ? ["--cookies", cookiesFile] : []),
      "-J",
      "--skip-download",
      "--no-warnings",
      url
    ];

    const { stdout } = await runYtDlp(args);
    const info = JSON.parse(stdout);

    return res.json({
      ok: true,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      webpage_url: info.webpage_url,
      extractor: info.extractor
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.stderr || err.message || "Gagal ambil info"
    });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !isAllowedUrl(url)) {
      return res.status(400).json({
        ok: false,
        error: "URL tidak valid. Hanya TikTok dan Instagram dulu."
      });
    }

    const tempDir = os.tmpdir();
    const uniqueId = crypto.randomUUID();
    const outputTemplate = path.join(tempDir, `${uniqueId}.%(ext)s`);

    const cookiesFile = ensureIgCookies();

    const args = [
      ...(cookiesFile ? ["--cookies", cookiesFile] : []),
      "-f", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", outputTemplate,
      url
    ];

    await runYtDlp(args);

    const matchedFiles = fs.readdirSync(tempDir).filter(name => name.startsWith(uniqueId));
    if (!matchedFiles.length) {
      throw new Error("File hasil download tidak ditemukan");
    }

    const finalName = matchedFiles[0];
    const finalPath = path.join(tempDir, finalName);

    res.download(finalPath, finalName, () => {
      fs.unlink(finalPath, () => {});
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.stderr || err.message || "Gagal download"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

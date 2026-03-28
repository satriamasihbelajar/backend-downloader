import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    return [
      "tiktok.com",
      "vm.tiktok.com",
      "vt.tiktok.com",
      "instagram.com"
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
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
    maxBuffer: 50 * 1024 * 1024
  });
  return { stdout, stderr };
}

app.get("/", (_req, res) => {
  res.send("Backend downloader hidup");
});

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.post("/api/info", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !isAllowedUrl(url)) {
      return res.status(400).json({
        ok: false,
        error: "URL tidak valid. Hanya TikTok dan Instagram yang didukung."
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
      title: info.title || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      webpage_url: info.webpage_url || url,
      extractor: info.extractor || null
    });
  } catch (err) {
    console.error("INFO ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: err.stderr || err.message || "Gagal ambil info video"
    });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !isAllowedUrl(url)) {
      return res.status(400).json({
        ok: false,
        error: "URL tidak valid. Hanya TikTok dan Instagram yang didukung."
      });
    }

    if (
      url.includes("tiktok.com") ||
      url.includes("vm.tiktok.com") ||
      url.includes("vt.tiktok.com")
    ) {
      const { stdout } = await runYtDlp([
        "-f",
        "best",
        "-g",
        url
      ]);

      return res.json({
        ok: true,
        video: stdout.trim()
      });
    }

    if (url.includes("instagram.com")) {
      try {
        const response = await fetch(`https://api.savetube.me/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data?.data?.url) {
          return res.json({
            ok: true,
            video: data.data.url
          });
        }
      } catch (e) {
        console.log("IG fallback 1 gagal");
      }

      try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data?.data?.play) {
          return res.json({
            ok: true,
            video: data.data.play
          });
        }
      } catch (e) {
        console.log("IG fallback 2 gagal");
      }

      try {
        const cookiesFile = ensureIgCookies();

        const args = [
          ...(cookiesFile ? ["--cookies", cookiesFile] : []),
          "-f",
          "best",
          "-g",
          url
        ];

        const { stdout } = await runYtDlp(args);

        return res.json({
          ok: true,
          video: stdout.trim()
        });
      } catch (e) {
        console.log("IG yt-dlp fallback gagal");
      }

      return res.status(500).json({
        ok: false,
        error: "Gagal ambil video Instagram"
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Platform belum didukung"
    });
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: err.stderr || err.message || "Gagal download video"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

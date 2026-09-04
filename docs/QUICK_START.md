# Synod Quick Start

## Start locally

### Windows

Double-click `start.bat`.

### macOS or Linux

```bash
chmod +x start.sh
./start.sh
```

The launcher checks Node.js 22+, installs dependencies, applies migrations, seeds a starter council, and opens `http://localhost:3000`.

For a manual start:

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm start
```

## Ask for the right depth

| Choose | Best for | Synod behavior |
| --- | --- | --- |
| **Quick answer** | A clear question or small decision | Fast mode, one round, three core perspectives. |
| **Detailed advice** | A consequential trade-off or plan | Deep mode, three rounds, and a council that expands with topic complexity. |

Type your question in the sidebar, then select **Ask Synod** or **Get advice**. Use the microphone to dictate and **Add context** to attach a file (up to 8 MB).

## Add phone context

Once a session begins, the sidebar displays a QR code. Scan it from a phone that can reach the Synod host to add a photo, audio file, or note to that decision.

## Connect a real model

1. Open **Settings**.
2. Add the selected provider key or AnythingLLM credentials.
3. Select **Test connections**.
4. Run a Quick answer and check for warnings.

Synod can run safely in mock mode without keys. Read the [User Manual](USER_MANUAL.md) for workflow guidance and the [Technical and Deployment Manual](TECHNICAL_DEPLOYMENT_MANUAL.md) for secure deployment.

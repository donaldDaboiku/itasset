# ITAssetTrack Deployment

This project can now run as one Node service that serves:

- the PWA frontend
- the `/api/data` SQLite backend
- a simple health check at `/api/health`

## Recommended hosting

Use a host with a persistent disk, for example:

- Render Web Service + persistent disk
- Railway with mounted volume
- a VPS running Node

Avoid serverless SQLite deployments for `/api/data`, because local filesystem
storage is not reliably persistent there.

## Render blueprint

This repo now includes [render.yaml](./render.yaml) for a Render web service
with a persistent disk mounted at `/opt/render/project/src/data`.

That mount path follows Render's guidance for Node apps that need a disk-backed
directory inside the project source path.

## 1. Set environment variables

Use `.env.example` as your template.

Required:

- `ITASSET_SYNC_TOKEN`
- `ITASSET_ALLOWED_ORIGIN`

Recommended:

- `PORT`
- `ITASSET_DB_DIR`

For Render Blueprint deploys:

- `ITASSET_SYNC_TOKEN` will be prompted in the dashboard because `render.yaml`
  marks it with `sync: false`
- `ITASSET_ALLOWED_ORIGIN` can be your Render URL first, then later your custom
  domain

## 2. Start locally

```bash
npm start
```

The app will be available at:

- `http://localhost:3000`
- backend health: `http://localhost:3000/api/health`
- backend API: `http://localhost:3000/api/data`

## Deploy On Render

1. Push this repo to GitHub.
2. In Render, choose `New +` → `Blueprint`.
3. Connect the repo and select this project.
4. When prompted, enter:
   - `ITASSET_SYNC_TOKEN`
   - `ITASSET_ALLOWED_ORIGIN`
5. Keep the attached persistent disk enabled.
6. Deploy.

After deploy, your app will be served from one Render web service.

Render will:

- run `npm install`
- start the app with `npm start`
- check `/api/health`
- persist SQLite data under the mounted disk path

## 3. Connect the frontend

In the app:

1. Open `Settings`
2. Go to `Backend Database Sync`
3. Set `Backend API URL` to `/api/data` if frontend and backend are on the same host
4. Paste the same `ITASSET_SYNC_TOKEN` into `Sync Token`

If the frontend is served by the same Render service, `/api/data` is the best
value because it keeps everything same-origin.

## 4. Test the backend

Health check:

```bash
curl http://localhost:3000/api/health
```

Authorized read:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/data
```

Render health endpoint:

```bash
curl https://your-service-name.onrender.com/api/health
```

## 5. Production note

If you deploy at `https://your-domain.com`, set:

```env
ITASSET_ALLOWED_ORIGIN=https://your-domain.com
```

## Render notes

- Persistent disks are available on paid Render services, not free ones.
- Only files written under the disk mount path are preserved across restarts.
- Because this app uses SQLite, keep it on a single disk-backed instance.

# Publish to GitHub (EN)

## 1) Prepare local repository
From project root:

```bash
git init
git add .
git commit -m "feat: initial bilingual documentation and ER/EER modeler setup"
```

## 2) Create remote repository
Options:
- GitHub web (New repository).
- GitHub CLI (`gh repo create`) if available.

## 3) Link remote and push
Replace `YOUR_USER` and `YOUR_REPO`:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

## 4) Recommended settings for this project
- Enable branch protection on `main`.
- Require PR reviews.
- Add Actions for `npm run build` and `npm run lint`.
- Ensure the `LICENSE` file (MIT) is included.

## 5) `.env` file
Do NOT commit real API keys.
Commit only `.env.example` placeholders.

## 6) Course-facing README
Use `README.md` as bilingual entrypoint and keep links to:
- `README.es.md`
- `README.en.md`
- `docs/ARCHITECTURE.*`
- `docs/CONTRIBUTING.*`

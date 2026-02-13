# Publicar en GitHub (ES)

## 1) Preparar repositorio local
Desde la raiz del proyecto:

```bash
git init
git add .
git commit -m "feat: documentacion inicial bilingue y setup del modelador ER/EER"
```

## 2) Crear repo remoto
Opciones:
- Desde GitHub web (New repository).
- Desde CLI (`gh repo create`) si usas GitHub CLI.

## 3) Enlazar remoto y subir
Reemplaza `TU_USUARIO` y `TU_REPO`:

```bash
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## 4) Recomendaciones para este proyecto
- Configurar branch protection en `main`.
- Habilitar PR reviews.
- Agregar Actions para `npm run build` y `npm run lint`.
- Verificar que el archivo `LICENSE` (MIT) este incluido.

## 5) Archivo `.env`
Asegurate de NO versionar claves reales.
Incluye solo `.env.example` con placeholders.

## 6) README para la catedra
Usar `README.md` como puerta de entrada bilingue y mantener enlaces a:
- `README.es.md`
- `README.en.md`
- `docs/ARCHITECTURE.*`
- `docs/CONTRIBUTING.*`

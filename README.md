# 📖 AmiLector — Lector de Documentos con Voz

**AmiLector** es un lector de documentos estático y privado que convierte PDFs, DOCX, TXT y Markdown en texto legible con lectura por voz de alta calidad usando las voces nativas de Google Chrome.

Todo funciona en el navegador. **Sin servidor, sin backend, sin cuentas.** Tus documentos nunca salen de tu dispositivo.

---

## ✨ Características

| Función | Detalle |
|---|---|
| **Formatos soportados** | PDF, DOCX, TXT, Markdown |
| **Lectura por voz (TTS)** | Web Speech API con voces de Google/Microsoft |
| **Resaltado en vivo** | Seguimiento palabra por palabra durante la lectura |
| **Temas de lectura** | Claro ☀, Oscuro 🌙 y Sepia 📜 |
| **Ajustes por documento** | Fuente, tamaño, ancho de columna, tema |
| **Progreso de lectura** | Guarda automáticamente la posición por documento |
| **Velocidad variable** | 0.75x, 1x, 1.25x, 1.5x, 2x |
| **Drag & Drop** | Arrastra archivos directamente a la ventana |
| **PWA** | Instalable como app con manifest.json |
| **100% privado** | Datos almacenados solo en IndexedDB local |

---

## 🚀 Inicio Rápido

### Prerrequisitos

- **Navegador recomendado**: Google Chrome o Microsoft Edge (mejor calidad de voces TTS)
- Un servidor HTTP local (cualquiera — los módulos ES6 requieren HTTP, no `file://`)

### Opción 1: Servidor local con Python

```bash
cd AmiLector
python3 -m http.server 8080
```

Abre http://localhost:8080

### Opción 2: Servidor local con Node.js

```bash
npx -y serve .
```

### Opción 3: VS Code Live Server

1. Instala la extensión **Live Server**
2. Clic derecho en `index.html` → "Open with Live Server"

### Opción 4: Deploy en Cloudflare Pages

```bash
# 1. Sube a un repo Git
git init && git add -A && git commit -m "initial"
git remote add origin https://github.com/tu-usuario/amilector.git
git push -u origin main

# 2. En Cloudflare Dashboard:
#    Pages → Create a project → Connect to Git
#    Build command: (vacío)
#    Build output directory: /
```

No se requiere build — es un sitio 100% estático.

---

## 📁 Estructura del Proyecto

```
AmiLector/
├── index.html          # SPA principal — todas las vistas y modales
├── manifest.json       # Manifest PWA para instalación
├── _headers            # Headers de seguridad y caché (Cloudflare Pages)
├── css/
│   └── styles.css      # Sistema de diseño completo (18KB)
├── js/
│   ├── app.js          # Controlador principal — vistas, upload, TTS, settings
│   ├── parser.js       # Pipeline de ingesta: PDF, DOCX, TXT, MD
│   ├── reader.js       # Motor TTS con fix de keepalive para Chrome
│   └── store.js        # Capa de persistencia IndexedDB (idb-keyval)
└── test-sample.txt     # Archivo de prueba
```

---

## 🏗️ Arquitectura

### Vista General

```
┌─────────────┐    ┌───────────┐    ┌──────────────┐
│  index.html │───▸│  app.js   │───▸│   store.js   │───▸ IndexedDB
│  (SPA)      │    │(controlador│    │ (idb-keyval) │
└─────────────┘    └─────┬─────┘    └──────────────┘
                         │
                   ┌─────┴─────┐
                   │           │
              ┌────▸ parser.js │    Ingesta de documentos
              │    └───────────┘
              │
              ├────▸ reader.js │    Motor TTS + Resaltado
              │    └───────────┘
              │
              └────▸ styles.css│    Sistema de diseño
                   └───────────┘
```

### Flujo de Ingesta de Documentos

```
Archivo → parser.js
  1. Reading     → Lee bytes del archivo
  2. Extracting  → Extrae texto crudo (pdf.js / mammoth.js / manual)
  3. Normalizing → Limpia y estructura como HTML semántico
  4. Analyzing   → Detecta idioma con franc-min (ISO 639-3 → 639-1)
  5. Segmenting  → Divide en chunks óptimos para TTS
  6. Done        → Guarda en IndexedDB via store.js
```

### Almacenamiento (IndexedDB)

Se usan **dos bases de datos separadas** con `idb-keyval`:

| Base de Datos | Object Store | Contenido |
|---|---|---|
| `amilector-docs` | `documents` | Documentos completos (chunks, HTML, progreso) |
| `amilector-settings` | `app-settings` | Configuración global de la aplicación |

> **Nota técnica**: `idb-keyval@6` crea una sola object store por llamada a `createStore()`. Usar el mismo nombre de BD para dos stores diferentes causa un `NotFoundError`. Por eso cada store usa su propia BD.

---

## 📦 Dependencias (CDN)

Todas las dependencias se cargan desde CDNs — no hay `node_modules` ni paso de build.

| Librería | Versión | Propósito | CDN |
|---|---|---|---|
| **idb-keyval** | 6.x | Key-value store sobre IndexedDB | jsdelivr |
| **pdfjs-dist** | 4.x | Extracción de texto de PDFs | jsdelivr |
| **mammoth** | 1.12.0 | Conversión de DOCX → HTML | jsdelivr |
| **franc-min** | 6.2.0 | Detección de idioma | esm.sh |

---

## 🎙️ Motor TTS (Text-to-Speech)

### Selección de Voces

El motor prioriza voces por calidad:

```
★★★ Google HD voices   (ej: "Google español")
★★  Microsoft voices   (ej: "Microsoft Helena")
★   Otras voces con nombre
☆   Voz por defecto del sistema
```

### Workaround: Chrome Keep-Alive

Chrome detiene silenciosamente la síntesis de voz después de ~15 segundos. AmiLector implementa un fix:

```
Cada 14 segundos:
  speechSynthesis.pause()
  speechSynthesis.resume()
```

Esto mantiene la sesión activa sin interrumpir la lectura audible.

### Lectura por Chunks

El texto se divide en fragmentos semánticos (párrafos/oraciones) y se reproducen secuencialmente. Esto permite:

- **Resaltado visual** del chunk activo
- **Auto-scroll** suave al texto que se está leyendo
- **Progreso** guardado por chunk index

---

## 🎨 Temas y Personalización

Cada documento guarda sus propios ajustes:

| Ajuste | Opciones |
|---|---|
| **Tema** | `light`, `dark`, `sepia` |
| **Tipografía** | `serif` (Georgia), `sans` (System UI), `mono` (Courier New) |
| **Tamaño fuente** | 0.8rem → 2.0rem (incrementos de 0.1) |
| **Ancho texto** | `narrow` (600px), `normal` (720px), `wide` (960px) |

---

## 🔒 Seguridad

El archivo `_headers` configura headers para Cloudflare Pages:

```
X-Frame-Options: DENY                    # Previene clickjacking
X-Content-Type-Options: nosniff          # Previene MIME sniffing
Referrer-Policy: no-referrer             # No envía referrer
Content-Security-Policy:                 # CSP restrictivo
  default-src 'self';
  script-src 'self' cdn.jsdelivr.net esm.sh;
  style-src 'self' 'unsafe-inline' fonts.googleapis.com;
  font-src fonts.gstatic.com;
  connect-src esm.sh cdn.jsdelivr.net;
  worker-src blob: cdn.jsdelivr.net;
  img-src 'self' data:
```

---

## 🧪 Desarrollo

### Ejecutar localmente

```bash
# Servidor simple (Python)
python3 -m http.server 8080 --directory .

# O con Node
npx -y serve . -p 8080
```

### Estructura de Módulos

Todos los archivos JS usan **ES Modules** (`import`/`export`):

```
app.js
 ├── import { parseDocument } from './parser.js'
 ├── import { saveDocument, getDocument, ... } from './store.js'
 └── import { TTSEngine, loadVoices, ... } from './reader.js'
```

### Agregar un nuevo formato

1. En `parser.js`, agrega la extensión al array `supported` (línea ~28)
2. Agrega un nuevo `case` en el `switch` de `parseDocument()`
3. Crea la función de parseo (ej: `parseEPUB(file)`)
4. Retorna `{ rawText, htmlContent }` como los demás parsers

### Modificar la UI

- Toda la interfaz está en `index.html` como vistas ocultas (`class="view"`)
- Las vistas se controlan con `showView('library' | 'reader')` en `app.js`
- Los estilos CSS usan variables custom (`--accent`, `--surface`, `--text`, etc.)

### Variables CSS principales

```css
--accent: #2563eb;      /* Azul principal */
--surface: #fff;        /* Fondo de tarjetas */
--bg: #f0ede8;          /* Fondo general */
--text: #1a1a2e;        /* Texto principal */
--text-secondary: #666; /* Texto secundario */
--border: #e0ddd8;      /* Bordes */
--danger: #dc2626;      /* Botones de eliminar */
```

---

## 🐛 Solución de Problemas

| Problema | Causa | Solución |
|---|---|---|
| **No se escucha la voz** | Navegador sin voces Google | Usa Chrome o Edge |
| **La voz se detiene sola** | Bug de Chrome sin keep-alive | Ya mitigado — si persiste, reinicia la pestaña |
| **"Formato no soportado"** | Extensión no reconocida | Solo `.pdf`, `.docx`, `.txt`, `.md` |
| **PDF sin texto** | PDF escaneado (imágenes) | El PDF necesita tener texto embebido |
| **Error CORS al abrir** | Abriendo con `file://` | Usa un servidor HTTP local |
| **NotFoundError en IndexedDB** | Versión antigua con BD corrupta | Limpia datos del sitio en DevTools |

### Limpiar datos de la aplicación

Si necesitas reiniciar desde cero:

1. Abre DevTools (F12)
2. Application → Storage → Clear site data
3. Recarga la página

---

## 📋 Formatos soportados en detalle

### PDF (`.pdf`)
- Usa `pdfjs-dist@4` para extraer texto página por página
- Reconstruye párrafos a partir de bloques de texto con heurísticas de posición
- **Limitación**: No soporta PDFs escaneados (requiere OCR previo)

### DOCX (`.docx`)
- Usa `mammoth@1.12.0` para convertir a HTML semántico
- Preserva encabezados, listas, negritas e itálicas
- Descarta imágenes y tablas complejas

### TXT (`.txt`)
- Parseo directo con detección de párrafos por líneas en blanco
- Soporte de Unicode completo

### Markdown (`.md`)
- Parser ligero integrado (sin dependencia externa)
- Soporta: headings, bold, italic, inline code, listas, blockquotes
- Convierte a HTML semántico

---

## 🌐 Deploy

### Cloudflare Pages (Recomendado)

1. Sube el proyecto a GitHub/GitLab
2. Conecta en Cloudflare Dashboard → Pages
3. **Build command**: *(vacío)*
4. **Build output directory**: `/`
5. Los headers de seguridad se aplican automáticamente via `_headers`

### GitHub Pages

1. Settings → Pages → Source: "Deploy from a branch"
2. Selecciona `main` / `root`
3. **Nota**: Los `_headers` no aplican en GitHub Pages — se necesita un `<meta>` CSP en su lugar

### Cualquier hosting estático

Solo necesitas servir los archivos tal cual. No hay paso de build, compilación, ni bundler.

---

## 📄 Licencia

Este proyecto es de uso personal. Contacta al autor para usos comerciales.

---

> **AmiLector** — Lee más. Escucha mejor. Todo en tu navegador. 📖🔊

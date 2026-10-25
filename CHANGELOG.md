# Historial de cambios

## [1.1.0] - 2026-10-25

### Añadido

- Interruptor de código de país en Lista Manual, activado por defecto con +51 Perú.
- Código editable y preferencias guardadas, sincronizadas entre Lista Manual y Excel/CSV.
- Pruebas de regresión del reenvío de archivos y del formato de números de teléfono.

### Corregido

- Detección de «Enviar» en español en controles con `role="button"`, títulos e iconos de envío.
- Búsqueda del botón en el pie del cuadro de reenvío y después de que WhatsApp sustituya sus elementos.
- Los controles de envío ocultos o deshabilitados se omiten; un clic sin cierre del cuadro se informa como fallo.
- Detección de casillas seleccionadas: un icono de casilla vacía ya no se interpreta como contacto marcado.
- Los números locales reciben el prefijo configurado sin duplicar el código existente. Los números internacionales con `+` conservan su propio código; con la opción activada se reconoce también el prefijo internacional `00`.
- Al desactivar el código automático, los dígitos del número se conservan sin añadir prefijos ni eliminar ceros iniciales.
- Los envíos incompletos se registran como «Parcial»; los registros históricos con fallos ya no se muestran como éxitos completos.

### Validación

- 14 pruebas aisladas de reenvío y 5 pruebas del código de país.
- Prueba real de texto e imagen desde Mi Chat en una sesión de WhatsApp Web en español.
- Comprobación del interruptor manual y del valor +51 en Chrome.

### Instalación y actualización

Descarga `Automatizar-WhatsApp-ES-v1.1.0.zip` y descomprímelo. En `chrome://extensions`, activa el modo desarrollador y carga la carpeta que contiene `manifest.json`. Para una instalación existente, reemplaza sus archivos, pulsa **Recargar** y recarga WhatsApp Web.

## [1.0.0] - 2026-10-24

- Versión inicial de este fork en español, publicada con la etiqueta `V1`.
- Interfaz en español y código de país configurable para Excel/CSV.

[1.1.0]: https://github.com/sebastianlezcanod-ui/Automatizar-WhatsApp-ES/compare/V1...v1.1.0
[1.0.0]: https://github.com/sebastianlezcanod-ui/Automatizar-WhatsApp-ES/releases/tag/V1

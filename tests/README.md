# Pruebas de regresión

Requieren Node.js, Google Chrome y el paquete `playwright` disponible en Node.js. Instala Playwright en un entorno de desarrollo independiente o usa un runtime que ya lo incluya.

Desde la raíz del proyecto:

```sh
node tests/forwarding.test.cjs
node tests/country-code.test.cjs
```

Las pruebas abren una sesión aislada de Chrome con pantallas simuladas. No acceden a WhatsApp, no usan la sesión del usuario y no envían mensajes. El inicio real de la cola se intercepta en la prueba del código de país.

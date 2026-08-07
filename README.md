# Inventario de Bodega Clínica — versión final corregida

PWA local, offline y auditable para administrar productos, lotes y movimientos de la bodega del laboratorio clínico.

## Sustituir el repositorio

1. Exporte primero un respaldo JSON desde la PWA publicada.
2. Extraiga `hsjdinventario-pwa-final.zip`.
3. Reemplace el contenido del repositorio por el contenido interno de esta carpeta.
4. Mantenga las carpetas `icons`, `js` y `tests`.
5. Espere a que GitHub Pages publique la nueva versión.
6. Abra la PWA y pulse **Actualizar ahora** si aparece el aviso.

La base mantiene el nombre `labInventoryDB`; los registros existentes son compatibles y no deberían perderse al sustituir archivos. El respaldo previo sigue siendo obligatorio como medida de seguridad.

## Probar en Windows

Ejecute `iniciar.bat`. El iniciador usa Python cuando está disponible y, en caso contrario, utiliza `servidor.ps1`. No requiere Node.js ni `npx`.

Abra manualmente `http://localhost:8000` si el navegador no se inicia.

## Funciones

- Productos y lotes con código único.
- Entradas, salidas, bajas y ajustes atómicos en IndexedDB.
- Existencia protegida: no se modifica directamente al editar un producto.
- Archivado y reactivación sin eliminación destructiva.
- Alertas independientes de stock bajo, agotamiento, vencimiento y próximo vencimiento.
- Umbral de vencimiento configurable entre 1 y 730 días.
- Bitácora de auditoría.
- Respaldo JSON validado antes de reemplazar la base.
- CSV de inventario y movimientos protegido contra fórmulas de hojas de cálculo.
- Sincronización de cambios entre pestañas.
- Solicitud de almacenamiento persistente.
- Service worker aislado para no borrar cachés de otras PWA.

## Almacenamiento

Los datos permanecen en IndexedDB dentro del navegador. No existe sincronización con servidor ni entre dispositivos. Use siempre el mismo navegador y perfil, y conserve respaldos fuera del equipo.

## Pruebas

Con Node.js instalado:

```bash
node tests/model.test.js
```

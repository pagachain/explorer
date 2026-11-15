# Pagachain Explorer

Explorador ligero de Pagachain (cadena 3690369). Es una página estática: no tiene base de datos ni servidor propio. El navegador lee el RPC `https://pagachain.com` en directo.

## Qué muestra

- Últimos bloques y transacciones. Los bloques que solo llevan la transacción de sistema se ocultan por defecto (se pueden mostrar con un interruptor).
- Búsqueda por hash de transacción, número o hash de bloque, o dirección.
- Rutas EIP-3091: `/block/<n>`, `/tx/<hash>`, `/address/<addr>`, `/token/<addr>`.
- En una dirección: saldo nativo (CENT), saldo PAGA y, si hay, WCENT. Historial de transferencias PAGA y WCENT con `eth_getLogs`.
- En un token: nombre, símbolo, decimales, suministro y transferencias recientes.
- En una transacción: estado, de, a, valor, gas y transferencias ERC-20 descifradas.

CENT es el gas nativo de Pagachain, no un contrato ERC-20 en esta cadena. El contrato PAGA es `0xbfE1D53cb99f5873E3d62EfaAc4F7d0cC2f94b9A` (6 decimales). En `0x4200…0006` está Wrapped Cent (WCENT).

El nodo (`op-reth`) limita `eth_getLogs` a **100 000 bloques** por consulta. El historial se pagina en tramos de ese tamaño.

El RPC responde con `Access-Control-Allow-Origin: *`, así que el navegador puede llamarlo en directo. nginx también ofrece un proxy en `/rpc` por si eso cambia.

## Instalación en el servidor

Con nginx ya instalado, un solo comando (ver la release) deja los archivos en `/var/www/html`, configura el sitio y recarga nginx.

Si el servidor ya tiene HTTPS (certbot en `explorer.pagachain.com`), el mismo comando solo actualiza los archivos estáticos y no pisa la configuración de nginx.

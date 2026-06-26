# Requirements Document

## Introduction

Esta funcionalidad permite al creador de un canal protegerlo con un código de acceso alfanumérico de exactamente 7 caracteres. Los canales protegidos son privados: únicamente los usuarios que ingresen el código correcto pueden unirse y ver los mensajes. Los canales sin clave permanecen públicos y accesibles para todos los usuarios autenticados. La clave se almacena de forma segura mediante hash bcrypt en el modelo `Channel`. Adicionalmente, el creador puede eliminar el canal junto con todos sus mensajes, y cualquier miembro (no creador) puede salirse voluntariamente de un canal al que se había unido.

---

## Glossary

- **Canal_Publico**: Canal sin código de acceso, visible y accesible para todos los usuarios autenticados.
- **Canal_Privado**: Canal con un código de acceso definido, al que solo pueden acceder usuarios que presenten el código correcto.
- **Clave_Acceso**: Código alfanumérico de exactamente 7 caracteres (letras A-Z, a-z y dígitos 0-9) que protege un canal.
- **Clave_Hash**: Representación segura de la `Clave_Acceso` almacenada en la base de datos mediante bcrypt.
- **Creador**: Usuario autenticado que crea un canal y puede opcionalmente definir su `Clave_Acceso`. Es el único que puede eliminar el canal.
- **Member**: Usuario autenticado que ha verificado la clave (en un `Canal_Privado`) o simplemente accedido (en un `Canal_Publico`) y forma parte activa de un canal sin ser su `Creador`.
- **Canal_Store**: Colección MongoDB que persiste los documentos de canales (modelo `Channel`), incluyendo el campo `creatorId`.
- **Message_Store**: Colección MongoDB que persiste los documentos de mensajes (modelo `Message`), asociados a un canal mediante `channelId`.
- **Access_Guard**: Componente del servidor responsable de verificar la `Clave_Acceso` antes de conceder acceso a un `Canal_Privado`.
- **Channel_Service**: Capa de lógica del servidor (en `server.js`) que gestiona la creación, consulta, eliminación y membresía de canales.
- **Message_Service**: Capa de lógica del servidor responsable de crear y eliminar mensajes en el `Message_Store`.
- **Frontend_UI**: Interfaz de usuario en el navegador (`app.js`, `index.html`) que gestiona la interacción del usuario con los canales.

---

## Requirements

### Requirement 1: Selección de tipo y definición de clave al crear un canal

**User Story:** Como Creador, quiero elegir explícitamente si el canal es público o privado al crearlo, y si elijo privado, definir una clave de acceso de 7 caracteres, para controlar quién puede acceder al canal.

#### Acceptance Criteria

1. THE `Frontend_UI` SHALL mostrar un selector de tipo de canal con las opciones "Público" y "Privado" en el formulario de creación de canal, con "Público" seleccionado por defecto.
2. WHEN el `Creador` selecciona "Público", THE `Frontend_UI` SHALL ocultar el campo de clave de acceso y el `Channel_Service` SHALL crear el canal como `Canal_Publico` sin `Clave_Hash`.
3. WHEN el `Creador` selecciona "Privado", THE `Frontend_UI` SHALL mostrar el campo de texto etiquetado "Clave de acceso (7 caracteres alfanuméricos)" y SHALL requerirlo antes de permitir el envío del formulario.
4. IF el `Creador` intenta enviar el formulario con tipo "Privado" y el campo de clave vacío, THEN THE `Frontend_UI` SHALL bloquear el envío y mostrar el mensaje "La clave de acceso es obligatoria para canales privados".
5. WHEN el `Creador` ingresa una `Clave_Acceso` con tipo "Privado", THE `Frontend_UI` SHALL validar que la clave contenga exactamente 7 caracteres alfanuméricos (A-Z, a-z, 0-9) antes de enviar la solicitud.
6. IF el `Creador` ingresa una `Clave_Acceso` con formato inválido, THEN THE `Frontend_UI` SHALL mostrar el mensaje "La clave debe tener exactamente 7 caracteres alfanuméricos" y bloquear el envío del formulario.
7. WHEN el `Channel_Service` recibe una solicitud de creación de canal con tipo "Privado" y `Clave_Acceso` válida, THE `Channel_Service` SHALL generar una `Clave_Hash` con bcrypt (factor de costo 10) y almacenarla en el `Canal_Store`.
8. THE `Channel_Service` SHALL almacenar un campo booleano `isPrivate` en el `Canal_Store` con valor `true` cuando el tipo es "Privado", y `false` cuando es "Público".

---

### Requirement 2: Visibilidad de canales en la lista

**User Story:** Como usuario autenticado, quiero ver todos los canales en la lista del sidebar, para saber cuáles existen, aunque no pueda acceder a los privados sin la clave.

#### Acceptance Criteria

1. THE `Channel_Service` SHALL incluir el campo `isPrivate` en la respuesta del endpoint `GET /api/channels` para cada canal.
2. THE `Channel_Service` SHALL omitir la `Clave_Hash` de la respuesta del endpoint `GET /api/channels` para no exponer el secreto al cliente.
3. WHEN la `Frontend_UI` recibe la lista de canales, THE `Frontend_UI` SHALL renderizar un ícono de candado junto al nombre de cada `Canal_Privado`.
4. THE `Channel_Service` SHALL listar todos los canales (`Canal_Publico` y `Canal_Privado`) para cualquier usuario autenticado, sin filtrado por acceso.

---

### Requirement 3: Flujo de acceso a un canal privado

**User Story:** Como usuario autenticado, quiero que se me solicite la clave cuando intento acceder a un canal privado, para poder unirme si la conozco.

#### Acceptance Criteria

1. WHEN el usuario hace clic en un `Canal_Privado` en la lista, THE `Frontend_UI` SHALL mostrar un diálogo modal solicitando la `Clave_Acceso` antes de cargar los mensajes.
2. THE `Frontend_UI` SHALL enmascarar los caracteres del campo de clave en el modal (tipo `password`).
3. WHEN el usuario hace clic en un `Canal_Publico`, THE `Frontend_UI` SHALL cargar los mensajes del canal directamente sin solicitar clave.
4. WHEN el usuario cancela el modal de clave, THE `Frontend_UI` SHALL cerrar el modal y mantener el canal activo anterior sin cambios.

---

### Requirement 4: Verificación de clave en el servidor

**User Story:** Como sistema, quiero verificar la clave de acceso en el servidor antes de permitir el acceso a un canal privado, para garantizar que la protección no pueda ser eludida desde el cliente.

#### Acceptance Criteria

1. THE `Channel_Service` SHALL exponer el endpoint `POST /api/channels/:id/verify-key` que reciba el campo `accessKey` en el cuerpo de la solicitud.
2. WHEN el `Access_Guard` recibe una solicitud en `POST /api/channels/:id/verify-key`, THE `Access_Guard` SHALL comparar la `accessKey` recibida con la `Clave_Hash` almacenada usando `bcrypt.compare`.
3. WHEN la `accessKey` coincide con la `Clave_Hash`, THE `Access_Guard` SHALL responder con HTTP 200 y el objeto del canal.
4. IF la `accessKey` no coincide con la `Clave_Hash`, THEN THE `Access_Guard` SHALL responder con HTTP 403 y el mensaje "Clave de acceso incorrecta".
5. IF el canal referenciado en la solicitud es un `Canal_Publico`, THEN THE `Access_Guard` SHALL responder con HTTP 400 y el mensaje "Este canal no requiere clave de acceso".
6. IF el campo `accessKey` está ausente o vacío en la solicitud, THEN THE `Access_Guard` SHALL responder con HTTP 400 y el mensaje "La clave de acceso es requerida".
7. THE `Access_Guard` SHALL requerir autenticación de sesión válida en el endpoint `POST /api/channels/:id/verify-key`.

---

### Requirement 5: Control de acceso a mensajes y WebSocket en canales privados

**User Story:** Como sistema, quiero que los endpoints de mensajes y la suscripción WebSocket también estén protegidos para canales privados, para evitar que usuarios sin la clave accedan al contenido por rutas alternativas.

#### Acceptance Criteria

1. WHEN el `Channel_Service` recibe `GET /api/channels/:id/messages` para un `Canal_Privado`, THE `Channel_Service` SHALL verificar que el usuario ha presentado la `Clave_Acceso` correcta en la sesión actual antes de devolver los mensajes.
2. IF el usuario no ha verificado la clave para un `Canal_Privado`, THEN THE `Channel_Service` SHALL responder con HTTP 403 y el mensaje "Acceso denegado: se requiere clave de acceso".
3. WHEN el servidor recibe un mensaje WebSocket de tipo `subscribe` para un `Canal_Privado`, THE `Channel_Service` SHALL verificar que el usuario ha verificado la clave antes de suscribirlo al canal.
4. IF el usuario intenta suscribirse por WebSocket a un `Canal_Privado` sin verificación previa, THEN THE `Channel_Service` SHALL enviar al cliente un mensaje WebSocket de tipo `error` con el texto "Acceso denegado al canal privado".
5. THE `Channel_Service` SHALL mantener en memoria de sesión (o en el objeto WebSocket del servidor) una lista de canales privados a los que el usuario tiene acceso verificado en la sesión actual.

---

### Requirement 6: Seguridad del almacenamiento de la clave

**User Story:** Como administrador del sistema, quiero que las claves de acceso se almacenen de forma segura mediante hash, para que no puedan ser recuperadas en texto plano en caso de acceso no autorizado a la base de datos.

#### Acceptance Criteria

1. THE `Channel_Service` SHALL almacenar únicamente la `Clave_Hash` generada por bcrypt con factor de costo 10 en el `Canal_Store`, nunca la `Clave_Acceso` en texto plano.
2. THE `Channel_Service` SHALL omitir el campo `accessKeyHash` de todas las respuestas JSON de la API.
3. IF el `Canal_Store` es consultado directamente, THEN el campo almacenado SHALL ser la `Clave_Hash` bcrypt y no la `Clave_Acceso` original.
4. WHEN se compara una `Clave_Acceso` presentada con la `Clave_Hash`, THE `Access_Guard` SHALL utilizar exclusivamente `bcrypt.compare` para evitar comparaciones en texto plano.

---

### Requirement 7: Experiencia de usuario en el flujo de acceso con clave

**User Story:** Como usuario, quiero recibir retroalimentación clara durante el proceso de ingreso de clave, para saber si el acceso fue concedido o rechazado.

#### Acceptance Criteria

1. WHEN el usuario envía la `Clave_Acceso` en el modal, THE `Frontend_UI` SHALL deshabilitar el botón de confirmación y mostrar un indicador de carga hasta recibir respuesta del servidor.
2. WHEN el servidor responde con HTTP 200, THE `Frontend_UI` SHALL cerrar el modal y cargar los mensajes del `Canal_Privado`.
3. IF el servidor responde con HTTP 403, THEN THE `Frontend_UI` SHALL mostrar el mensaje "Clave incorrecta. Inténtalo de nuevo." dentro del modal sin cerrarlo.
4. IF el servidor responde con un error de red, THEN THE `Frontend_UI` SHALL mostrar el mensaje "Error de conexión. Inténtalo de nuevo." dentro del modal.
5. WHEN el usuario accede exitosamente a un `Canal_Privado`, THE `Frontend_UI` SHALL mostrar el ícono de candado desbloqueado junto al nombre del canal activo durante la sesión.

---

### Requirement 8: Validación del formato de la clave en el servidor

**User Story:** Como sistema, quiero validar el formato de la clave también en el servidor, para garantizar la integridad de los datos independientemente del cliente.

#### Acceptance Criteria

1. WHEN el `Channel_Service` recibe una solicitud `POST /api/channels` con campo `accessKey`, THE `Channel_Service` SHALL validar que la `accessKey` contenga exactamente 7 caracteres alfanuméricos (A-Z, a-z, 0-9).
2. IF la `accessKey` recibida en `POST /api/channels` no cumple el formato, THEN THE `Channel_Service` SHALL responder con HTTP 400 y el mensaje "La clave debe tener exactamente 7 caracteres alfanuméricos".
3. WHEN el `Access_Guard` recibe una solicitud `POST /api/channels/:id/verify-key`, THE `Access_Guard` SHALL validar que el campo `accessKey` contenga exactamente 7 caracteres alfanuméricos antes de proceder a la comparación con bcrypt.
4. IF la `accessKey` en `POST /api/channels/:id/verify-key` no cumple el formato, THEN THE `Access_Guard` SHALL responder con HTTP 400 y el mensaje "La clave debe tener exactamente 7 caracteres alfanuméricos".

---

### Requirement 9: Eliminación de canal por el creador

**User Story:** Como Creador, quiero poder eliminar un canal que creé junto con todos sus mensajes, para poder retirarlo permanentemente del sistema cuando ya no sea necesario.

#### Acceptance Criteria

1. THE `Channel_Service` SHALL exponer el endpoint `DELETE /api/channels/:id` que requiera autenticación de sesión válida.
2. WHEN el `Channel_Service` recibe `DELETE /api/channels/:id`, THE `Channel_Service` SHALL verificar que el `creatorId` almacenado en el `Canal_Store` coincide con el identificador del usuario autenticado antes de proceder.
3. IF el usuario autenticado no es el `Creador` del canal, THEN THE `Channel_Service` SHALL responder con HTTP 403 y el mensaje "Solo el creador puede eliminar el canal".
4. WHEN el `Creador` envía `DELETE /api/channels/:id` para un canal que le pertenece, THE `Channel_Service` SHALL eliminar todos los mensajes del canal del `Message_Store` antes de eliminar el documento del canal del `Canal_Store`.
5. WHEN la eliminación del canal y sus mensajes se completa, THE `Channel_Service` SHALL responder con HTTP 200 y notificar a todos los clientes conectados por WebSocket mediante un mensaje de tipo `channel_deleted` que incluya el identificador del canal eliminado.
6. WHEN la `Frontend_UI` recibe un mensaje WebSocket de tipo `channel_deleted`, THE `Frontend_UI` SHALL eliminar el canal de la lista del sidebar y, si el canal eliminado era el canal activo, SHALL mostrar un mensaje informativo al usuario y limpiar la vista de mensajes.
7. IF el canal referenciado en `DELETE /api/channels/:id` no existe en el `Canal_Store`, THEN THE `Channel_Service` SHALL responder con HTTP 404 y el mensaje "El canal especificado no existe".
8. THE `Canal_Store` SHALL almacenar el campo `creatorId` con el identificador del usuario autenticado en el momento de la creación del canal.

---

### Requirement 10: Salida voluntaria de un canal

**User Story:** Como Member, quiero poder salirme de un canal al que me uní, para dejar de recibir sus mensajes y retirarme voluntariamente sin necesidad de acción por parte del creador.

#### Acceptance Criteria

1. THE `Channel_Service` SHALL exponer el endpoint `DELETE /api/channels/:id/membership` que requiera autenticación de sesión válida.
2. WHEN el `Channel_Service` recibe `DELETE /api/channels/:id/membership` de un `Member`, THE `Channel_Service` SHALL eliminar al usuario de la lista de miembros del canal en el `Canal_Store` y responder con HTTP 200.
3. IF el usuario autenticado que envía `DELETE /api/channels/:id/membership` es el `Creador` del canal, THEN THE `Channel_Service` SHALL responder con HTTP 403 y el mensaje "El creador no puede salirse del canal; use la opción de eliminar canal".
4. WHEN un `Member` sale exitosamente de un `Canal_Privado`, THE `Channel_Service` SHALL invalidar el acceso verificado del usuario a ese canal en la sesión actual, de modo que el usuario deba volver a verificar la `Clave_Acceso` para reingresar.
5. WHEN un `Member` sale exitosamente de un `Canal_Publico`, THE `Channel_Service` SHALL eliminar al usuario de la lista de miembros, sin requerir verificación de clave para reingresar.
6. WHEN la `Frontend_UI` recibe la respuesta HTTP 200 de `DELETE /api/channels/:id/membership`, THE `Frontend_UI` SHALL eliminar el canal de la vista del usuario y, si era el canal activo, SHALL limpiar la vista de mensajes.
7. IF el canal referenciado en `DELETE /api/channels/:id/membership` no existe en el `Canal_Store`, THEN THE `Channel_Service` SHALL responder con HTTP 404 y el mensaje "El canal especificado no existe".
8. IF el usuario autenticado no es miembro del canal referenciado, THEN THE `Channel_Service` SHALL responder con HTTP 400 y el mensaje "El usuario no es miembro de este canal".

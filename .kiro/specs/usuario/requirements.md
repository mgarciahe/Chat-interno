# Requirements Document

## Introduction

Esta funcionalidad extiende el panel de información lateral de la aplicación de chat en tiempo real para mostrar,
además del contador numérico de usuarios conectados ya existente, la lista completa de nombres de pantalla
(display names) de los usuarios que tienen una conexión WebSocket activa en ese momento.

El objetivo es mejorar la percepción de presencia social dentro de la aplicación: los usuarios autenticados
podrán ver exactamente quiénes están en línea sin necesidad de consultas adicionales. La lista se actualizará
en tiempo real mediante el mecanismo WebSocket ya establecido, aprovechando el atributo `ws.username` que el
servidor ya almacena en cada conexión autenticada.

La funcionalidad no introduce cambios en el modelo de datos ni en el mecanismo de autenticación existente;
únicamente agrega un nuevo tipo de mensaje WebSocket y la correspondiente lógica de presentación en el frontend.

## Glossary

- **Sistema**: La aplicación web de chat en tiempo real (servidor Node.js/Express + frontend HTML/CSS/JS vanilla).
- **Presence_Service**: El módulo del servidor responsable de mantener y difundir la lista de usuarios conectados en tiempo real.
- **Presence_List**: La estructura en memoria del servidor que contiene los nombres de pantalla de todas las conexiones WebSocket autenticadas activas.
- **Presence_Panel**: El componente visual del panel derecho del frontend que muestra el contador numérico y la lista de usuarios conectados.
- **WebSocket_Client**: Cada conexión WebSocket individual de un usuario autenticado al servidor.
- **Usuario**: Persona autenticada que interactúa con la aplicación a través del navegador.
- **Nombre de pantalla**: El identificador visible del usuario en el chat, almacenado en el campo `username` del modelo `User` y disponible como `ws.username` en cada conexión WebSocket autenticada.
- **Evento de presencia**: Mensaje WebSocket de tipo `presence_update` que el servidor envía a todos los clientes cuando la lista de usuarios conectados cambia.

## Requirements

### Requirement 1: Difusión de la lista de usuarios conectados

**User Story:** Como usuario autenticado, quiero que el servidor me notifique en tiempo real quiénes están conectados, para que mi cliente siempre tenga información actualizada de presencia sin necesidad de hacer peticiones adicionales.

#### Acceptance Criteria

1. WHEN un WebSocket_Client establece una conexión autenticada, THE Presence_Service SHALL añadir el nombre de pantalla del usuario a la Presence_List.
2. WHEN un WebSocket_Client cierra su conexión, THE Presence_Service SHALL eliminar el nombre de pantalla del usuario de la Presence_List.
3. WHEN la Presence_List cambia (por conexión o desconexión de cualquier usuario), THE Presence_Service SHALL transmitir un mensaje de tipo `presence_update` a todos los WebSocket_Client activos que contiene el arreglo completo y actualizado de nombres de pantalla.
4. WHEN un WebSocket_Client recién conectado recibe su primer mensaje del servidor, THE Presence_Service SHALL incluir en ese mensaje inicial el arreglo completo de nombres de pantalla actualmente en la Presence_List.
5. THE Presence_Service SHALL incluir en cada mensaje `presence_update` exactamente los campos `type` con valor `"presence_update"` y `users` con el arreglo de cadenas de texto de nombres de pantalla.
6. IF un usuario tiene más de una conexión WebSocket activa simultánea, THEN THE Presence_Service SHALL incluir el nombre de pantalla de ese usuario una vez por cada conexión activa en la Presence_List.

---

### Requirement 2: Visualización de la lista en el Presence_Panel

**User Story:** Como usuario autenticado, quiero ver la lista de nombres de los usuarios conectados en el panel lateral derecho, para saber de un vistazo quiénes están disponibles en el chat.

#### Acceptance Criteria

1. WHEN el Presence_Panel recibe un mensaje `presence_update`, THE Sistema SHALL actualizar el contenido de la sección de lista de usuarios conectados sin recargar la página.
2. THE Presence_Panel SHALL mantener visible el indicador de punto verde y el contador numérico existente (`id="connections-count"`) en todo momento mientras el usuario esté en el workspace del chat.
3. THE Presence_Panel SHALL mostrar los nombres de pantalla de la lista de usuarios conectados debajo del contador numérico existente, dentro de la sección `status-card` del panel derecho.
4. WHEN la lista de usuarios conectados contiene al menos un elemento, THE Presence_Panel SHALL renderizar cada nombre de pantalla como un elemento de lista independiente.
5. WHEN la lista de usuarios conectados está vacía, THE Presence_Panel SHALL mostrar un texto indicativo de que no hay usuarios conectados en lugar de una lista vacía.
6. THE Sistema SHALL actualizar el contador numérico existente con el valor de `data.count` del mensaje `connection_count` y actualizar la lista de nombres con el arreglo `data.users` del mensaje `presence_update` de forma independiente.

---

### Requirement 3: Seguridad y privacidad de presencia

**User Story:** Como administrador del sistema, quiero que la información de presencia solo sea accesible para usuarios autenticados, para mantener la coherencia con el modelo de seguridad existente de la aplicación.

#### Acceptance Criteria

1. WHILE un usuario no tiene una sesión autenticada válida, THE Presence_Service SHALL no transmitir información de la Presence_List a ese WebSocket_Client.
2. THE Presence_Service SHALL obtener los nombres de pantalla exclusivamente del atributo `ws.username` establecido durante el handshake WebSocket autenticado, sin aceptar nombres provistos por el cliente en mensajes posteriores.
3. THE Presence_Service SHALL incluir en la Presence_List únicamente los nombres de pantalla de conexiones WebSocket que hayan superado la validación de sesión existente en el evento `upgrade` del servidor.

---

### Requirement 4: Consistencia y robustez de la lista

**User Story:** Como usuario autenticado, quiero que la lista de usuarios conectados sea siempre coherente con el estado real del servidor, para no ver información de presencia desactualizada o incorrecta.

#### Acceptance Criteria

1. WHEN el servidor procesa el evento `close` de un WebSocket_Client, THE Presence_Service SHALL actualizar la Presence_List y difundir el mensaje `presence_update` antes de finalizar el procesamiento del evento de cierre.
2. WHEN el servidor procesa el evento `connection` de un nuevo WebSocket_Client, THE Presence_Service SHALL actualizar la Presence_List y difundir el mensaje `presence_update` después de incrementar el contador de conexiones activas.
3. IF el arreglo de usuarios en el mensaje `presence_update` recibido por el cliente no es un arreglo válido, THEN THE Sistema SHALL ignorar la actualización de la lista sin lanzar excepciones ni interrumpir la conexión WebSocket.
4. THE Presence_Service SHALL construir la Presence_List leyendo el atributo `ws.username` de cada cliente en `wss.clients` cuyo `readyState` sea `WebSocket.OPEN` en el momento de la difusión.

---

### Requirement 5: Integración con el ciclo de vida de la sesión

**User Story:** Como usuario autenticado, quiero que la lista de usuarios conectados se limpie correctamente cuando cierro sesión, para que mi nombre no aparezca como conectado después de haber salido de la aplicación.

#### Acceptance Criteria

1. WHEN un usuario ejecuta el cierre de sesión explícito y el WebSocket_Client es cerrado por el frontend, THE Presence_Service SHALL procesar el evento `close` del WebSocket y eliminar el nombre de pantalla del usuario de la Presence_List.
2. WHEN la conexión WebSocket de un usuario se interrumpe de forma inesperada (pérdida de red o cierre de pestaña), THE Presence_Service SHALL detectar el evento `close` del WebSocket_Client y eliminar el nombre de pantalla de la Presence_List sin requerir acción explícita del usuario.
3. WHEN el Presence_Panel detecta que la conexión WebSocket se ha cerrado y el frontend inicia la reconexión automática, THE Sistema SHALL mantener visible la última lista conocida de usuarios conectados hasta que se reciba un nuevo mensaje `presence_update` tras la reconexión exitosa.

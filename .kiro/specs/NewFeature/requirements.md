# Documento de Requisitos

## Introducción

Esta funcionalidad permite a los usuarios autenticados grabar y enviar mensajes de audio dentro de los canales de chat en tiempo real. Los audios quedan almacenados en el servidor y se reproducen directamente desde el chat, integrándose de forma nativa con el sistema de mensajería existente (WebSockets, MongoDB, Express).

## Glosario

- **Grabador**: Componente del frontend que accede al micrófono del dispositivo y captura audio mediante la API `MediaRecorder` del navegador.
- **Mensaje_Audio**: Mensaje de tipo `audio` almacenado en la base de datos, que contiene una referencia al archivo de audio en lugar de contenido de texto.
- **Reproductor**: Elemento `<audio>` del navegador que reproduce el archivo de audio directamente en el chat.
- **Servidor**: Aplicación Node.js/Express que gestiona la lógica de negocio, almacenamiento de archivos y comunicación WebSocket.
- **Almacén_Audio**: Directorio del servidor donde se guardan los archivos de audio cargados por los usuarios.
- **WebSocket_Server**: Servidor de WebSockets (`ws`) que distribuye mensajes en tiempo real a los clientes suscritos a un canal.
- **BD**: Base de datos MongoDB gestionada mediante Mongoose.
- **Usuario**: Persona autenticada con sesión activa que interactúa con el chat.
- **Canal**: Sala de conversación identificada por nombre único donde los usuarios intercambian mensajes.
- **Validador**: Módulo del servidor encargado de verificar el formato, tamaño y tipo MIME de los archivos recibidos.

---

## Requisitos

### Requisito 1: Acceso al micrófono y grabación de audio

**Historia de usuario:** Como usuario autenticado, quiero grabar un mensaje de audio directamente desde el chat, para poder comunicarme por voz sin salir de la aplicación.

#### Criterios de aceptación

1. WHEN el Usuario activa el botón de grabación, THE Grabador SHALL solicitar permiso de acceso al micrófono del dispositivo mediante la API `getUserMedia`.
2. WHEN el Usuario concede el permiso de micrófono, THE Grabador SHALL iniciar la captura de audio en formato `audio/webm` con códec `opus`.
3. IF el Usuario deniega el permiso de micrófono, THEN THE Grabador SHALL mostrar un mensaje de error indicando que el acceso al micrófono es necesario para grabar audio.
4. WHILE el Grabador está activo, THE Grabador SHALL mostrar un indicador visual de grabación en curso y el tiempo transcurrido en segundos.
5. WHEN el Usuario detiene la grabación, THE Grabador SHALL detener la captura y generar un `Blob` de audio listo para ser enviado.
6. THE Grabador SHALL limitar la duración máxima de grabación a 120 segundos y detener automáticamente la captura al alcanzar ese límite.
7. WHEN la grabación alcanza el límite de 120 segundos, THE Grabador SHALL notificar al Usuario que se ha alcanzado la duración máxima.

---

### Requisito 2: Envío del mensaje de audio al servidor

**Historia de usuario:** Como usuario autenticado, quiero enviar el audio grabado al canal activo, para que otros participantes puedan escucharlo.

#### Criterios de aceptación

1. WHEN el Usuario confirma el envío del audio grabado, THE Grabador SHALL enviar el `Blob` de audio al Servidor mediante una petición `POST /api/channels/:id/audio` con `Content-Type: multipart/form-data`.
2. THE Servidor SHALL requerir una sesión autenticada válida para aceptar peticiones `POST /api/channels/:id/audio`; IF la sesión no es válida, THEN THE Servidor SHALL responder con código HTTP 401.
3. THE Validador SHALL rechazar archivos cuyo tamaño supere 10 MB, respondiendo con código HTTP 413 y un mensaje descriptivo.
4. THE Validador SHALL rechazar archivos cuyo tipo MIME no sea `audio/webm`, `audio/ogg` o `audio/mp4`, respondiendo con código HTTP 415 y un mensaje descriptivo.
5. WHEN el Validador aprueba el archivo, THE Servidor SHALL almacenar el archivo en el Almacén_Audio con un nombre de archivo único generado mediante `crypto.randomUUID()` y la extensión correspondiente al tipo MIME.
6. WHEN el archivo es almacenado correctamente, THE Servidor SHALL crear un Mensaje_Audio en la BD con los campos `channelId`, `author`, `type: "audio"` y `audioUrl` apuntando a la ruta pública del archivo.
7. IF ocurre un error al guardar el archivo o el Mensaje_Audio en la BD, THEN THE Servidor SHALL responder con código HTTP 500 y un mensaje descriptivo, sin dejar archivos huérfanos en el Almacén_Audio.

---

### Requisito 3: Distribución en tiempo real del mensaje de audio

**Historia de usuario:** Como participante de un canal, quiero ver el mensaje de audio recibido en tiempo real, para estar al tanto de la conversación sin recargar la página.

#### Criterios de aceptación

1. WHEN el Servidor guarda un Mensaje_Audio exitosamente, THE WebSocket_Server SHALL difundir un evento de tipo `message` al payload `{ type: "message", channelName, message: Mensaje_Audio }` a todos los clientes suscritos al canal correspondiente.
2. WHEN el frontend recibe un evento `message` con un mensaje cuyo campo `type` es `"audio"`, THE Reproductor SHALL renderizar un elemento `<audio>` con atributo `controls` dentro de la burbuja del mensaje en el chat.
3. THE Reproductor SHALL mostrar el nombre del autor y la marca de tiempo del Mensaje_Audio junto al elemento `<audio>`, siguiendo el mismo estilo visual de los mensajes de texto existentes.
4. WHEN se añade un Mensaje_Audio al chat y el Usuario se encontraba cerca del final de la conversación, THE Reproductor SHALL desplazar automáticamente el contenedor de mensajes hacia abajo.

---

### Requisito 4: Reproducción de mensajes de audio

**Historia de usuario:** Como usuario, quiero reproducir mensajes de audio directamente en el chat, para escucharlos sin descargar archivos manualmente.

#### Criterios de aceptación

1. THE Reproductor SHALL renderizar cada Mensaje_Audio como un elemento `<audio>` nativo con atributo `controls` visible, permitiendo reproducción, pausa y control de volumen.
2. WHEN el Usuario accede al historial de mensajes de un canal, THE Servidor SHALL devolver los Mensaje_Audio almacenados en la BD incluyendo el campo `audioUrl`, de modo que el frontend pueda renderizar el Reproductor correctamente.
3. THE Servidor SHALL servir los archivos del Almacén_Audio en la ruta `/uploads/audio/:filename` como archivos estáticos con el encabezado `Content-Type` apropiado.
4. IF el archivo de audio referenciado por `audioUrl` no existe en el Almacén_Audio, THEN THE Reproductor SHALL mostrar un texto indicando que el audio no está disponible en lugar del elemento `<audio>`.

---

### Requisito 5: Validación en el cliente antes del envío

**Historia de usuario:** Como usuario, quiero recibir retroalimentación inmediata si el audio no puede ser enviado, para entender qué ocurrió sin esperar respuesta del servidor.

#### Criterios de aceptación

1. WHEN el Usuario intenta enviar un audio grabado, THE Grabador SHALL verificar que la duración del audio sea mayor a 0 segundos antes de iniciar la petición al Servidor; IF la duración es 0 segundos, THEN THE Grabador SHALL mostrar un mensaje de error y cancelar el envío.
2. THE Grabador SHALL mostrar un indicador de carga mientras la petición de subida al Servidor esté en curso.
3. IF el Servidor responde con un código de error HTTP, THEN THE Grabador SHALL mostrar al Usuario un mensaje de error descriptivo correspondiente al código recibido y cancelar el indicador de carga.
4. WHEN el Servidor responde con éxito, THE Grabador SHALL limpiar el estado de grabación y ocultar el indicador de carga.

---

### Requisito 6: Integración con el modelo de mensaje existente

**Historia de usuario:** Como desarrollador, quiero que los mensajes de audio sean una extensión del modelo `Message` existente, para mantener coherencia en la base de datos y minimizar cambios en la arquitectura.

#### Criterios de aceptación

1. THE BD SHALL almacenar los Mensaje_Audio en la colección `messages` existente, añadiendo los campos opcionales `type` (valor `"audio"`) y `audioUrl` (URL de tipo `String`) al esquema `Message`.
2. THE BD SHALL mantener retrocompatibilidad: los documentos de mensajes de texto existentes que no posean el campo `type` SHALL ser tratados como tipo `"text"` por el frontend.
3. THE Servidor SHALL incluir los Mensaje_Audio en las respuestas del endpoint `GET /api/channels/:id/messages`, dentro del mismo array de mensajes que los mensajes de texto.
4. THE Servidor SHALL aplicar el mismo índice compuesto `{ channelId: 1, createdAt: -1 }` existente para ordenar y paginar Mensaje_Audio junto a mensajes de texto.

---

### Requisito 7: Seguridad en la subida y servicio de archivos de audio

**Historia de usuario:** Como administrador del sistema, quiero que la subida y el servicio de archivos de audio sean seguros, para prevenir abusos y vulnerabilidades.

#### Criterios de aceptación

1. THE Validador SHALL verificar el tipo MIME del archivo tanto por el encabezado `Content-Type` enviado por el cliente como por la firma de bytes (magic bytes) del archivo, rechazando archivos que no coincidan con tipos de audio permitidos.
2. THE Servidor SHALL aplicar el limitador de tasa de creación existente (`creationLimiter`) a las peticiones `POST /api/channels/:id/audio`.
3. THE Servidor SHALL generar nombres de archivo en el Almacén_Audio usando `crypto.randomUUID()`, sin preservar el nombre original del archivo enviado por el cliente, para evitar ataques de path traversal.
4. THE Servidor SHALL servir los archivos del Almacén_Audio como estáticos con la política de Content Security Policy existente, incluyendo `mediaSrc ["'self'"]` para restringir el origen de los archivos de audio.
5. IF un Usuario no autenticado intenta acceder a `GET /uploads/audio/:filename`, THEN THE Servidor SHALL responder con código HTTP 401.

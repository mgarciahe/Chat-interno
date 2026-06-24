# Requirements Document

## Introduction

Aplicación de chat en tiempo real estilo Discord para uso local. Permite a los usuarios crear y unirse a canales de texto, enviar mensajes y recibir actualizaciones en tiempo real sin necesidad de recargar la página. El stack es Node.js con Express en el backend, MongoDB con Mongoose como base de datos, y HTML/CSS/JavaScript en el frontend.

## Glossary

- **Sistema**: La aplicación de chat en tiempo real en su conjunto.
- **Servidor_HTTP**: El servidor Express que gestiona las peticiones HTTP y sirve los archivos estáticos.
- **Servidor_WS**: El servidor WebSocket (integrado con Express) que gestiona la comunicación en tiempo real.
- **BD**: La base de datos MongoDB accedida mediante Mongoose.
- **Canal**: Sala de texto con nombre único donde los usuarios pueden enviar y leer mensajes.
- **Mensaje**: Texto enviado por un usuario dentro de un canal, con marca de tiempo y nombre de autor. Un mensaje válido tiene contenido no vacío (ni compuesto solo de espacios en blanco), longitud ≤ 2000 caracteres y `channelId` existente.
- **Usuario**: Persona que accede a la aplicación con un nombre de pantalla único dentro de una sesión.
- **Sesión**: Período de actividad de un usuario desde que introduce su nombre hasta que cierra el navegador.
- **Cliente**: El navegador web que ejecuta la interfaz HTML/CSS/JavaScript.

---

## Requirements

### Requirement 1: Gestión de Usuarios (Sesión Simple)

**User Story:** Como usuario, quiero identificarme con un nombre de pantalla al abrir la aplicación, para que mis mensajes aparezcan con mi nombre en los canales.

#### Acceptance Criteria

1. WHEN el Cliente carga la aplicación por primera vez, THE Sistema SHALL mostrar un formulario de entrada de nombre de pantalla antes de acceder a la interfaz principal.
2. WHEN el usuario envía el formulario de nombre de pantalla con un valor no vacío y no compuesto únicamente de espacios en blanco, THE Sistema SHALL almacenar el nombre en la sesión del Cliente mediante localStorage y redirigir a la interfaz principal.
3. IF el usuario envía el formulario de nombre de pantalla con un valor vacío o compuesto únicamente de espacios en blanco, THEN THE Sistema SHALL mostrar un mensaje de error indicando que el nombre no puede estar vacío.
4. WHILE el usuario tiene una sesión activa, THE Sistema SHALL asociar todos los mensajes enviados con su nombre de pantalla.
5. THE Sistema SHALL limitar el nombre de pantalla a un máximo de 32 caracteres.
6. IF el nombre de pantalla introducido supera 32 caracteres, THEN THE Sistema SHALL mostrar un mensaje de error indicando que el nombre no puede superar 32 caracteres.
7. WHEN el Cliente carga la aplicación y existe un nombre almacenado en localStorage, THE Sistema SHALL recuperar el nombre y omitir el formulario de entrada, accediendo directamente a la interfaz principal.

---

### Requirement 2: Gestión de Canales

**User Story:** Como usuario, quiero ver la lista de canales disponibles y crear nuevos canales, para organizar las conversaciones por tema.

#### Acceptance Criteria

1. THE Servidor_HTTP SHALL exponer un endpoint `GET /api/channels` que devuelva la lista de todos los canales existentes en la BD.
2. WHEN el usuario solicita la lista de canales, THE Cliente SHALL mostrar los canales en un panel lateral ordenados alfabéticamente por nombre.
3. WHEN el usuario envía el formulario de creación de canal con un nombre único no vacío, THE Servidor_HTTP SHALL crear el canal en la BD y devolver el canal creado con código HTTP 201.
4. IF el usuario intenta crear un canal con un nombre que ya existe (comparación case-insensitive), THEN THE Servidor_HTTP SHALL devolver un error con código HTTP 409 y el mensaje "Ya existe un canal con ese nombre".
5. IF el usuario intenta crear un canal con un nombre vacío o compuesto únicamente de espacios en blanco, THEN THE Servidor_HTTP SHALL devolver un error con código HTTP 400 y el mensaje "El nombre del canal no puede estar vacío".
6. IF el nombre del canal supera 64 caracteres, THEN THE Servidor_HTTP SHALL devolver un error con código HTTP 400.
7. WHEN un canal nuevo es creado por cualquier usuario, THE Servidor_WS SHALL notificar a todos los Clientes conectados para que actualicen su lista de canales en tiempo real.

---

### Requirement 3: Envío y Recepción de Mensajes en Tiempo Real

**User Story:** Como usuario, quiero enviar mensajes en un canal y verlos aparecer en tiempo real para todos los participantes, para tener conversaciones fluidas.

#### Acceptance Criteria

1. WHEN el usuario selecciona un canal, THE Cliente SHALL establecer una suscripción al Servidor_WS para ese canal.
2. WHEN el usuario selecciona un canal, THE Cliente SHALL solicitar al Servidor_HTTP el historial de mensajes recientes del canal.
3. THE Servidor_HTTP SHALL exponer un endpoint `GET /api/channels/:id/messages` que devuelva los últimos 50 mensajes del canal ordenados de más antiguo a más reciente.
4. WHEN el usuario envía un mensaje válido en un canal, THE Cliente SHALL transmitir el mensaje al Servidor_WS con el nombre del canal, el nombre del usuario y el contenido del mensaje.
5. WHEN el Servidor_WS recibe un mensaje válido, THE Servidor_WS SHALL persistir el mensaje en la BD con los campos: canal, autor, contenido y marca de tiempo (timestamp UTC).
6. WHEN el Servidor_WS persiste un mensaje, THE Servidor_WS SHALL difundirlo a todos los Clientes suscritos al mismo canal.
7. WHEN el Cliente recibe un mensaje nuevo del Servidor_WS y el usuario se encontraba dentro de 50px del final del área de mensajes, THE Cliente SHALL añadir el mensaje al final del área de mensajes y desplazar la vista automáticamente hacia abajo.
8. WHEN el Cliente recibe un mensaje nuevo del Servidor_WS y el usuario se encontraba a más de 50px del final del área de mensajes, THE Cliente SHALL añadir el mensaje al final del área de mensajes sin modificar la posición de desplazamiento actual.
9. IF el usuario intenta enviar un mensaje vacío o compuesto únicamente de espacios en blanco, THEN THE Cliente SHALL ignorar el envío sin mostrar error.
10. IF el usuario intenta enviar un mensaje cuyo contenido supera 2000 caracteres, THEN THE Cliente SHALL bloquear el envío y mostrar un indicador de error señalando que el mensaje excede la longitud máxima permitida.
11. IF el Servidor_WS no puede persistir el mensaje en la BD, THEN THE Servidor_WS SHALL notificar al remitente con un mensaje de error y no difundir el mensaje a los demás Clientes.

---

### Requirement 4: Persistencia de Mensajes

**User Story:** Como usuario, quiero que los mensajes enviados anteriormente sean visibles al abrir un canal, para no perder el historial de conversación.

#### Acceptance Criteria

1. THE BD SHALL almacenar cada mensaje con los campos obligatorios: `channelId` (referencia al canal), `author` (string), `content` (string), `createdAt` (Date UTC).
2. WHEN el Servidor_HTTP recibe una solicitud `GET /api/channels/:id/messages`, THE Servidor_HTTP SHALL consultar la BD y devolver los últimos 50 mensajes del canal especificado ordenados por `createdAt` ascendente.
3. IF el canal especificado en la solicitud no existe en la BD, THEN THE Servidor_HTTP SHALL devolver un error con código HTTP 404.
4. IF el `:id` del canal en la solicitud no es un ObjectId válido de MongoDB, THEN THE Servidor_HTTP SHALL devolver un error con código HTTP 400.
5. IF la BD no está disponible al recibir una solicitud, THEN THE Servidor_HTTP SHALL devolver un error con código HTTP 503.
6. THE BD SHALL indexar la colección de mensajes con un índice compuesto `{ channelId: 1, createdAt: -1 }` para garantizar que las consultas de historial se resuelvan en menos de 200 ms para colecciones de hasta 100.000 mensajes.

---

### Requirement 5: Indicador de Usuarios Conectados

**User Story:** Como usuario, quiero ver cuántos usuarios están conectados actualmente, para saber si hay alguien con quien chatear.

#### Acceptance Criteria

1. WHEN el Servidor_WS inicia, THE Servidor_WS SHALL inicializar el contador de conexiones activas a 0.
2. WHEN un Cliente establece conexión con el Servidor_WS, THE Servidor_WS SHALL incrementar el contador de conexiones activas y enviar el conteo actual de conexiones activas a ese Cliente recién conectado.
3. WHEN un Cliente cierra la conexión con el Servidor_WS, THE Servidor_WS SHALL decrementar el contador de conexiones activas.
4. WHILE hay al menos un Cliente conectado, THE Servidor_WS SHALL difundir el número actualizado de usuarios conectados a todos los Clientes cada vez que el contador cambia.
5. THE Cliente SHALL mostrar el número de usuarios conectados en la interfaz principal y actualizarlo en tiempo real sin recargar la página en un plazo máximo de 1 segundo tras producirse el cambio.

---

### Requirement 6: Interfaz de Usuario

**User Story:** Como usuario, quiero una interfaz clara y funcional, para navegar entre canales y enviar mensajes cómodamente.

#### Acceptance Criteria

1. THE Cliente SHALL presentar un diseño de tres columnas: panel de canales a la izquierda, área de mensajes en el centro y panel de información (usuarios conectados) a la derecha.
2. WHEN el usuario selecciona un canal en el panel lateral, THE Cliente SHALL resaltar visualmente el canal activo con un fondo de color distinto observable y cargar los últimos 50 mensajes del historial del canal.
3. WHEN el área de mensajes carga el historial y el usuario no se encontraba previamente en ese canal, THE Cliente SHALL desplazar la vista automáticamente hacia el mensaje más reciente.
4. WHEN el área de mensajes contiene más mensajes de los visibles y el usuario se encuentra a más de 50px del final, THE Cliente SHALL mostrar una barra de desplazamiento vertical sin anclar la vista automáticamente al mensaje más reciente.
5. THE Cliente SHALL mostrar cada mensaje con el nombre del autor, el contenido y la hora de envío en formato `HH:MM` usando la zona horaria local del navegador.
6. THE Cliente SHALL ser usable en resoluciones de pantalla de 1024×768 píxeles o superiores.
7. THE Cliente no SHALL generar scroll horizontal en resoluciones de ancho iguales o superiores a 1024px.

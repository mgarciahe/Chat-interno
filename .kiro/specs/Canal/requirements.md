# Requirements Document

## Introduction

Esta funcionalidad introduce un selector explícito de tipo de canal ("Público" / "Privado") en el formulario de creación de canales de la aplicación de chat en tiempo real. Actualmente el formulario expone un campo de clave opcional sin indicar visualmente si el canal resultante será público o privado, lo que genera ambigüedad para el usuario.

Con esta funcionalidad el usuario seleccionará el tipo de canal antes de escribir el nombre, el campo de clave solo aparecerá cuando se elija "Privado" (y pasará a ser obligatorio), y el campo `isPrivate` se persistirá explícitamente en el modelo `Channel`. El servidor validará la consistencia entre el tipo declarado y la presencia o ausencia de clave. Adicionalmente, la lista de canales del sidebar reflejará el tipo de cada canal mediante un ícono de candado para los privados.

Esta funcionalidad es complementaria al spec **Clave**, que se ocupa de la verificación de la clave de acceso y el control de acceso posterior. El presente spec se enfoca exclusivamente en el flujo de selección de tipo durante la creación del canal.

---

## Glossary

- **Canal**: Sala de conversación en tiempo real identificada por un nombre único. Puede ser `Canal_Publico` o `Canal_Privado`.
- **Canal_Publico**: Canal cuyo campo `isPrivate` vale `false`. Es accesible para todos los usuarios autenticados sin necesidad de clave.
- **Canal_Privado**: Canal cuyo campo `isPrivate` vale `true`. Requiere una `Clave_Acceso` de 7 caracteres alfanuméricos para ser creado y, posteriormente, para ser accedido (gestionado por el spec Clave).
- **Clave_Acceso**: Código alfanumérico de exactamente 7 caracteres (A-Z, a-z, 0-9) requerido al crear un `Canal_Privado`.
- **Selector_Tipo**: Control de la interfaz (botones de radio o selector equivalente) que permite al usuario elegir entre "Público" y "Privado" antes de crear el canal.
- **Formulario_Creacion**: Sección del sidebar que contiene el `Selector_Tipo`, el campo de nombre del canal, el campo de `Clave_Acceso` (condicional) y el botón de creación.
- **Campo_Clave**: Campo de texto de tipo contraseña etiquetado "Clave de acceso (7 caracteres alfanuméricos)" que aparece en el `Formulario_Creacion` únicamente cuando el tipo seleccionado es "Privado".
- **Creador**: Usuario autenticado que completa y envía el `Formulario_Creacion`.
- **Channel_Service**: Capa de lógica del servidor (`server.js`) que gestiona la creación y consulta de canales, incluyendo la validación de consistencia entre tipo e informacion de clave.
- **Canal_Store**: Colección MongoDB que persiste los documentos de canales (modelo `Channel`), incluyendo los campos `isPrivate` y `accessKeyHash`.
- **Frontend_UI**: Interfaz de usuario en el navegador (`app.js`, `index.html`) que gestiona la interacción del usuario con el `Formulario_Creacion` y la lista de canales.
- **Sidebar**: Panel lateral izquierdo de la aplicación que lista los canales disponibles.

---

## Requirements

### Requirement 1: Selector explícito de tipo de canal en el formulario de creación

**User Story:** Como Creador, quiero ver un selector claro de tipo ("Público" / "Privado") en el formulario de creación de canal, para saber exactamente qué tipo de canal estoy creando antes de confirmarlo.

#### Acceptance Criteria

1. THE `Frontend_UI` SHALL mostrar el `Selector_Tipo` con las opciones "Público" y "Privado" dentro del `Formulario_Creacion`, posicionado antes del campo de nombre del canal.
2. WHEN el `Formulario_Creacion` se inicializa o se resetea tras una creación exitosa, THE `Frontend_UI` SHALL establecer la opción "Público" como valor seleccionado por defecto en el `Selector_Tipo`.
3. THE `Frontend_UI` SHALL renderizar el `Selector_Tipo` de forma que ambas opciones sean visibles simultáneamente y la opción activa esté visualmente diferenciada (por ejemplo, mediante resaltado de color o borde).
4. WHILE el usuario interactúa con el `Formulario_Creacion`, THE `Frontend_UI` SHALL mantener el estado del `Selector_Tipo` sincronizado con la visibilidad del `Campo_Clave` en tiempo real, sin requerir recargar la página.

---

### Requirement 2: Visibilidad condicional del campo de clave según el tipo seleccionado

**User Story:** Como Creador, quiero que el campo de clave aparezca únicamente cuando selecciono "Privado", para no tener que ignorar campos irrelevantes cuando creo un canal público.

#### Acceptance Criteria

1. WHEN el usuario selecciona "Público" en el `Selector_Tipo`, THE `Frontend_UI` SHALL ocultar el `Campo_Clave` y SHALL limpiar cualquier valor que hubiera ingresado en él.
2. WHEN el usuario selecciona "Privado" en el `Selector_Tipo`, THE `Frontend_UI` SHALL mostrar el `Campo_Clave` etiquetado "Clave de acceso (7 caracteres alfanuméricos)".
3. WHILE la opción "Privado" está seleccionada en el `Selector_Tipo`, THE `Frontend_UI` SHALL marcar el `Campo_Clave` como campo obligatorio (`required`) en el DOM.
4. WHILE la opción "Público" está seleccionada en el `Selector_Tipo`, THE `Frontend_UI` SHALL remover el atributo `required` del `Campo_Clave` para que el formulario pueda enviarse sin clave.

---

### Requirement 3: Validación del formulario en el cliente antes del envío

**User Story:** Como Creador, quiero recibir retroalimentación inmediata en el formulario antes de que la solicitud llegue al servidor, para corregir errores sin esperar una respuesta de red.

#### Acceptance Criteria

1. IF el usuario intenta enviar el `Formulario_Creacion` con el tipo "Privado" y el `Campo_Clave` vacío, THEN THE `Frontend_UI` SHALL bloquear el envío y SHALL mostrar el mensaje "La clave de acceso es obligatoria para canales privados".
2. IF el usuario ingresa una `Clave_Acceso` que no cumpla exactamente 7 caracteres alfanuméricos (A-Z, a-z, 0-9), THEN THE `Frontend_UI` SHALL bloquear el envío y SHALL mostrar el mensaje "La clave debe tener exactamente 7 caracteres alfanuméricos".
3. IF el usuario intenta enviar el `Formulario_Creacion` con el campo de nombre del canal vacío o compuesto solo de espacios, THEN THE `Frontend_UI` SHALL bloquear el envío y SHALL mostrar el mensaje "El nombre del canal no puede estar vacío".
4. WHEN todas las validaciones del cliente son superadas, THE `Frontend_UI` SHALL enviar la solicitud `POST /api/channels` incluyendo los campos `name`, `isPrivate` (booleano) y, si el tipo es "Privado", `accessKey`.

---

### Requirement 4: Persistencia del tipo de canal en el servidor

**User Story:** Como sistema, quiero que el tipo de canal declarado por el Creador se persista correctamente en la base de datos, para que la lógica de acceso posterior pueda basarse en ese dato de forma fiable.

#### Acceptance Criteria

1. WHEN el `Channel_Service` recibe `POST /api/channels` con `isPrivate: false`, THE `Channel_Service` SHALL crear el documento en el `Canal_Store` con el campo `isPrivate` igual a `false` y el campo `accessKeyHash` igual a `null`.
2. WHEN el `Channel_Service` recibe `POST /api/channels` con `isPrivate: true` y una `Clave_Acceso` válida, THE `Channel_Service` SHALL crear el documento en el `Canal_Store` con el campo `isPrivate` igual a `true` y el campo `accessKeyHash` con el hash bcrypt de la `Clave_Acceso`.
3. THE `Channel_Service` SHALL almacenar el campo `isPrivate` como campo booleano explícito en el `Canal_Store`, sin inferirlo a partir de la presencia o ausencia de `accessKeyHash`.

---

### Requirement 5: Validación de consistencia en el servidor

**User Story:** Como sistema, quiero validar en el servidor que el tipo declarado y los datos de clave sean coherentes, para garantizar la integridad de los canales independientemente del cliente que realice la solicitud.

#### Acceptance Criteria

1. IF el `Channel_Service` recibe `POST /api/channels` con `isPrivate: true` y el campo `accessKey` ausente o vacío, THEN THE `Channel_Service` SHALL responder con HTTP 400 y el mensaje "La clave de acceso es obligatoria para canales privados".
2. IF el `Channel_Service` recibe `POST /api/channels` con `isPrivate: true` y una `accessKey` que no cumpla exactamente 7 caracteres alfanuméricos (A-Z, a-z, 0-9), THEN THE `Channel_Service` SHALL responder con HTTP 400 y el mensaje "La clave debe tener exactamente 7 caracteres alfanuméricos".
3. IF el `Channel_Service` recibe `POST /api/channels` con `isPrivate: false` y el campo `accessKey` presente y no vacío, THEN THE `Channel_Service` SHALL responder con HTTP 400 y el mensaje "Los canales públicos no pueden tener clave de acceso".
4. WHEN el `Channel_Service` recibe `POST /api/channels` con `isPrivate: false` y sin campo `accessKey`, THE `Channel_Service` SHALL crear el canal como `Canal_Publico` sin requerir ni procesar ninguna clave.

---

### Requirement 6: Representación visual del tipo de canal en el sidebar

**User Story:** Como usuario autenticado, quiero ver de un vistazo qué canales son privados en la lista del sidebar, para saber antes de hacer clic si necesitaré una clave de acceso.

#### Acceptance Criteria

1. THE `Channel_Service` SHALL incluir el campo `isPrivate` en la respuesta del endpoint `GET /api/channels` para cada canal listado.
2. WHEN la `Frontend_UI` renderiza la lista de canales en el `Sidebar`, THE `Frontend_UI` SHALL mostrar un ícono de candado (🔒) como prefijo del nombre de cada `Canal_Privado`.
3. WHEN la `Frontend_UI` renderiza la lista de canales en el `Sidebar`, THE `Frontend_UI` SHALL mostrar el símbolo "#" como prefijo del nombre de cada `Canal_Publico`.
4. WHEN la `Frontend_UI` recibe un mensaje WebSocket de tipo `channel_created`, THE `Frontend_UI` SHALL actualizar la lista del `Sidebar` reflejando el tipo correcto del nuevo canal (ícono de candado o "#") sin requerir recarga completa de la lista.

---

### Requirement 7: Consistencia visual del tipo tras la creación

**User Story:** Como Creador, quiero que el formulario quede en un estado limpio y coherente tras crear un canal exitosamente, para poder crear otro canal sin confusión de estado.

#### Acceptance Criteria

1. WHEN el `Channel_Service` responde con HTTP 201 a una solicitud de creación de canal, THE `Frontend_UI` SHALL limpiar el campo de nombre del canal, restablecer el `Selector_Tipo` a "Público" y ocultar el `Campo_Clave`.
2. WHEN el `Channel_Service` responde con HTTP 201 a una solicitud de creación de canal con tipo "Privado", THE `Frontend_UI` SHALL limpiar el `Campo_Clave` además de restablecer el resto del formulario.
3. IF el `Channel_Service` responde con un código de error (HTTP 4xx o 5xx), THEN THE `Frontend_UI` SHALL mantener los valores actuales del `Selector_Tipo`, del campo de nombre y del `Campo_Clave` para que el usuario pueda corregir y reintentar sin perder lo ingresado.

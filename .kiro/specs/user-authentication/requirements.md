# Requirements Document

## Introduction

Esta funcionalidad incorpora un sistema de autenticación completo a la aplicación de chat en tiempo real. Actualmente, la aplicación permite a los usuarios ingresar solo con un nombre de pantalla, sin verificación de identidad ni contraseña. La nueva funcionalidad reemplaza este mecanismo con registro de cuentas, inicio de sesión con contraseña y protección de rutas, de forma que solo los usuarios autenticados puedan acceder a los canales y enviar mensajes.

El sistema se integra con el stack existente: Node.js con Express, WebSockets (ws), MongoDB/Mongoose y el frontend en HTML/CSS/JS vanilla.

## Glossary

- **Sistema**: La aplicación web de chat en tiempo real (servidor Node.js/Express + frontend).
- **Auth_Service**: El módulo del servidor responsable del registro, inicio de sesión y validación de sesiones de usuario.
- **User_Store**: La capa de persistencia de datos de usuarios (modelo Mongoose `User` en MongoDB).
- **Session_Manager**: El componente del servidor que gestiona tokens de sesión mediante cookies firmadas.
- **Validator**: El componente que valida los datos de entrada proporcionados por el usuario (formato de email, longitud de contraseña, etc.).
- **Password_Hasher**: El componente que aplica hashing seguro a las contraseñas antes de almacenarlas.
- **Usuario**: Persona que interactúa con la aplicación a través del navegador.
- **Credenciales**: Combinación de dirección de correo electrónico y contraseña que identifica a un usuario.
- **Sesión**: Estado de autenticación de un usuario activo, representado por una cookie firmada en el navegador.
- **Nombre de pantalla**: Nombre visible del usuario en el chat, distinto del correo electrónico usado para autenticarse.
- **Ruta protegida**: Endpoint de la API o conexión WebSocket que requiere una sesión autenticada válida para operar.

## Requirements

### Requirement 1: Registro de nuevos usuarios

**User Story:** Como visitante de la aplicación, quiero crear una cuenta con correo electrónico, contraseña y nombre de pantalla, para poder identificarme de forma única y acceder al chat de manera segura.

#### Acceptance Criteria

1. WHEN un usuario envía el formulario de registro con correo electrónico, contraseña y nombre de pantalla válidos, THE Auth_Service SHALL crear una nueva cuenta de usuario, iniciar una sesión activa y redirigir al usuario al workspace del chat.
2. WHEN el Validator recibe una dirección de correo electrónico, THE Validator SHALL aceptarla únicamente si contiene exactamente un símbolo `@`, al menos un carácter antes del `@`, al menos un punto en el dominio y no excede 254 caracteres.
3. WHEN el Validator recibe una contraseña durante el registro, THE Validator SHALL rechazarla si tiene menos de 8 caracteres o más de 128 caracteres.
4. WHEN el Validator recibe un nombre de pantalla, THE Validator SHALL rechazarlo si tiene menos de 1 carácter o más de 32 caracteres después de eliminar espacios al inicio y al final.
5. WHEN un usuario intenta registrarse con una dirección de correo electrónico que ya existe en el User_Store, THE Auth_Service SHALL rechazar el registro, bloquear por completo la creación de la cuenta y devolver un mensaje de error indicando que el correo ya está en uso, sin revelar datos adicionales de la cuenta existente.
6. WHEN el registro es exitoso, THE Password_Hasher SHALL almacenar la contraseña como un hash bcrypt con un factor de coste mínimo de 10 en el User_Store, sin almacenar la contraseña en texto plano.
7. IF el User_Store no está disponible durante el registro, THEN THE Auth_Service SHALL impedir cualquier creación de cuenta y devolver un error HTTP 503 al cliente.

---

### Requirement 2: Inicio de sesión de usuarios existentes

**User Story:** Como usuario registrado, quiero iniciar sesión con mi correo electrónico y contraseña, para poder acceder al chat con mi identidad verificada.

#### Acceptance Criteria

1. WHEN un usuario envía el formulario de inicio de sesión con correo electrónico y contraseña correctos, THE Auth_Service SHALL validar las credenciales contra el User_Store, crear una Sesión activa y devolver el nombre de pantalla del usuario.
2. WHEN un usuario envía credenciales incorrectas (correo no registrado o contraseña errónea), THE Auth_Service SHALL rechazar el intento y devolver un mensaje de error genérico que no distinga entre correo inexistente y contraseña incorrecta.
3. WHEN el Auth_Service valida una contraseña durante el inicio de sesión, THE Password_Hasher SHALL comparar la contraseña recibida con el hash almacenado usando bcrypt, sin comparación en texto plano.
4. WHEN el inicio de sesión es exitoso, THE Session_Manager SHALL emitir una cookie HTTP-only firmada que contiene el identificador único del usuario, con tiempo de expiración de 24 horas.
5. WHEN un usuario envía el formulario de inicio de sesión con el campo de correo o contraseña vacío, THE Validator SHALL rechazar el intento antes de consultar el User_Store, y THE Password_Hasher SHALL omitir completamente la comparación de hash.
6. IF el User_Store no está disponible durante el inicio de sesión, THEN THE Auth_Service SHALL priorizar la indisponibilidad del almacenamiento y devolver un error HTTP 503 al cliente.

---

### Requirement 3: Protección de rutas y acceso al chat

**User Story:** Como administrador del sistema, quiero que todas las rutas del chat requieran autenticación válida, para que solo los usuarios registrados e identificados puedan acceder a los canales y enviar mensajes.

#### Acceptance Criteria

1. WHILE un usuario tiene una Sesión activa válida, THE Sistema SHALL permitir el acceso a los endpoints `/api/channels`, `/api/channels/:id/messages` y la conexión WebSocket.
2. WHEN una solicitud llega a una ruta protegida sin una cookie de sesión válida, THE Auth_Service SHALL rechazar la solicitud con un error HTTP 401 sin revelar información interna del sistema.
3. WHEN una conexión WebSocket intenta establecerse sin una cookie de sesión válida, THE Session_Manager SHALL rechazar el upgrade HTTP con código 401 y cerrar el socket.
4. WHEN el Session_Manager valida una cookie de sesión, THE Session_Manager SHALL verificar la firma criptográfica de la cookie y comprobar que el identificador de usuario contenido existe en el User_Store.
5. WHEN una sesión expira o la cookie es inválida, THE Auth_Service SHALL devolver un error HTTP 401 al cliente; el Sistema podrá devolver al usuario a la pantalla de inicio de sesión a criterio de la implementación del frontend, sin exponer información sensible del error.

---

### Requirement 4: Cierre de sesión

**User Story:** Como usuario autenticado, quiero poder cerrar mi sesión de forma explícita, para que mi cuenta quede protegida al terminar de usar la aplicación.

#### Acceptance Criteria

1. WHEN un usuario hace clic en el botón de cerrar sesión, THE Auth_Service SHALL invalidar la Sesión activa eliminando la cookie del navegador y devolver una respuesta HTTP 200.
2. WHEN el Auth_Service procesa el cierre de sesión, THE Session_Manager SHALL limpiar la cookie de sesión con las mismas opciones de seguridad (httpOnly, sameSite) con las que fue establecida.
3. WHEN la sesión es cerrada exitosamente (tanto la invalidación de sesión como la limpieza de cookie completadas), THE Sistema SHALL mostrar la pantalla de inicio de sesión al usuario.

---

### Requirement 5: Modelo de datos de usuario

**User Story:** Como desarrollador del sistema, quiero un modelo de datos de usuario bien definido en MongoDB, para garantizar la integridad y consistencia de la información de las cuentas.

#### Acceptance Criteria

1. THE User_Store SHALL persistir para cada usuario: un identificador único generado por MongoDB, la dirección de correo electrónico normalizada a minúsculas, el hash de contraseña, el nombre de pantalla y las marcas de tiempo de creación y actualización.
2. THE User_Store SHALL mantener un índice único sobre el campo de correo electrónico para garantizar que no existan dos cuentas con el mismo correo.
3. WHEN un documento de usuario es creado o actualizado, THE User_Store SHALL normalizar el campo de correo electrónico a minúsculas antes de persistirlo.
4. THE User_Store SHALL limitar la longitud del campo de correo electrónico a un máximo de 254 caracteres y el nombre de pantalla a un máximo de 32 caracteres a nivel de esquema.

---

### Requirement 6: Seguridad y limitación de intentos

**User Story:** Como administrador del sistema, quiero que los endpoints de autenticación estén protegidos contra ataques de fuerza bruta y enumeración de cuentas, para reducir el riesgo de compromisos de seguridad.

#### Acceptance Criteria

1. WHEN una misma dirección IP realiza más de 10 solicitudes a `/api/auth/login` o `/api/auth/register` dentro de un intervalo de 15 minutos, THE Sistema SHALL bloquear las solicitudes adicionales y devolver un error HTTP 429.
2. WHEN el Auth_Service devuelve un error de credenciales incorrectas durante el inicio de sesión, THE Auth_Service SHALL emplear un tiempo de respuesta constante independientemente de si el correo existe o no, para prevenir ataques de temporización.
3. WHEN se transmiten datos de autenticación entre el cliente y el servidor en entornos de producción, THE Sistema SHALL requerir que la comunicación utilice HTTPS; los entornos de desarrollo y pruebas podrán usar HTTP.
4. WHEN se almacenan contraseñas, THE Password_Hasher SHALL usar bcrypt con un factor de coste que resulte en un tiempo de hashing de al menos 100 ms en el hardware del servidor.

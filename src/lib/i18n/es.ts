// Spanish (Español) translations, keyed by the English source string.
// Keep keys byte-for-byte identical to the English text passed to t().
// Use {name} placeholders for interpolated values.

export const es: Record<string, string> = {
  // ── Generic / shared ──
  'Save': 'Guardar',
  'Saved': 'Guardado',
  'Cancel': 'Cancelar',
  'Edit': 'Editar',
  'Delete': 'Eliminar',
  'Export': 'Exportar',
  'Sign in': 'Iniciar sesión',
  'Sign up': 'Registrarse',
  'Sign out': 'Cerrar sesión',
  'Log out': 'Cerrar sesión',
  'Continue': 'Continuar',
  'Back': 'Atrás',
  'Next': 'Siguiente',
  'Done': 'Listo',
  'Close': 'Cerrar',
  'Loading…': 'Cargando…',
  'Something went wrong': 'Algo salió mal',
  'Something went wrong. Please try again.': 'Algo salió mal. Inténtalo de nuevo.',

  // ── Profile menu / nav ──
  'Settings': 'Configuración',
  'Home': 'Inicio',
  'Dashboard': 'Panel',
  'Rescan': 'Reescanear',
  'Pricing': 'Precios',
  'Contact': 'Contacto',
  'Account': 'Cuenta',
  'Credits': 'Créditos',

  // ── Settings: sign-in gate ──
  'Sign in to manage your account, appearance, render quality, and privacy settings.':
    'Inicia sesión para administrar tu cuenta, apariencia, calidad de renderizado y configuración de privacidad.',

  // ── Settings: Account ──
  'Your public display name': 'Tu nombre público para mostrar',
  'your username': 'tu nombre de usuario',

  // (No appearance strings: the app is dark, there is nothing to choose.)

  // ── Settings: Render Quality ──
  'Render Quality': 'Calidad de renderizado',
  'How sharply hairstyles render': 'Qué tan nítidos se renderizan los peinados',
  'Performance': 'Rendimiento',
  'Lighter render, faster on any device': 'Renderizado ligero, más rápido en cualquier dispositivo',
  'Balanced': 'Equilibrado',
  'Default — looks great on most screens': 'Predeterminado: se ve genial en la mayoría de las pantallas',
  'High': 'Alta',
  '3× pass render for maximum hair definition': 'Renderizado de 3 pasadas para la máxima definición del cabello',

  // ── Settings: Language ──
  'Language': 'Idioma',
  'App display language': 'Idioma de la aplicación',
  'English': 'English',
  'Español': 'Español',

  // ── Settings: 3D Scan ──
  '3D Scan': 'Escaneo 3D',
  'Rebuild your 3D head model from a new photo.': 'Reconstruye tu modelo 3D de cabeza con una nueva foto.',

  // ── Settings: Privacy & Data ──
  'Privacy & Data': 'Privacidad y datos',
  'Improve ShapeUp': 'Mejorar ShapeUp',
  'We use your information to enhance our user experience.':
    'Usamos tu información para mejorar la experiencia de usuario.',
  'Biometric consent': 'Consentimiento biométrico',
  'not granted': 'no otorgado',
  "What's that?": '¿Qué es eso?',
  'Revoke consent': 'Revocar consentimiento',
  'Consent revoked. Your facial scans have been deleted.':
    'Consentimiento revocado. Tus escaneos faciales han sido eliminados.',
  "This is your go-ahead for us to turn your selfie into a personal 3D head model — the magic that lets you try on cuts and see how they actually sit on you. Your scan stays yours: kept private and just for your models. You can revoke this anytime and we'll delete it. One heads-up — once you revoke, state law means we can't build any new models for you.":
    'Esta es tu autorización para que convirtamos tu selfie en un modelo 3D personal de tu cabeza, la magia que te permite probarte cortes y ver cómo te quedan de verdad. Tu escaneo sigue siendo tuyo: se mantiene privado y solo para tus modelos. Puedes revocarlo en cualquier momento y lo eliminaremos. Un aviso: una vez que lo revoques, la ley estatal implica que no podremos crear nuevos modelos para ti.',
  'Download my data': 'Descargar mis datos',
  'Export your account info as JSON (GDPR / CCPA).':
    'Exporta la información de tu cuenta como JSON (GDPR / CCPA).',
  'Delete account': 'Eliminar cuenta',
  'Permanently removes your data. This cannot be undone.':
    'Elimina tus datos de forma permanente. Esto no se puede deshacer.',
  'Confirm delete': 'Confirmar eliminación',
  'All scans, projects, and your account will be deleted.':
    'Se eliminarán todos los escaneos, proyectos y tu cuenta.',
  'policy': 'política',
  'Spanish': 'Español',
  'Japanese': 'Japonés',

  // ── Tokens / profile menu ──
  'Tokens': 'Fichas',
  '{plan} plan': 'Plan {plan}',
  'Includes {n} free/month · resets monthly, unused don\'t roll over': 'Incluye {n} gratis/mes · se reinicia cada mes, lo no usado no se acumula',
  'Get more tokens': 'Obtener más fichas',
  'Refer a friend for': 'Invita a un amigo por',
  '6 tokens': '6 fichas',
  'REDEEM A CODE': 'CANJEAR UN CÓDIGO',
  'Redeem': 'Canjear',
  'Show my barber a 360°': 'Mostrar a mi barbero un 360°',

  // ── Dashboard popups ──
  'Scan now!': '¡Escanea ahora!',
  'Drop in the chair and start styling yourself in 3D!':
    '¡Siéntate en la silla y empieza a peinarte en 3D!',
  'Take Picture': 'Tomar foto',
  "You've hit the limit of {max} cuts. Delete one to make room for a fresh style.":
    'Has alcanzado el límite de {max} cortes. Elimina uno para hacer espacio para un nuevo estilo.',
  'Got it': 'Entendido',

  // ── Referral popup ──
  'Refer a friend': 'Invita a un amigo',
  'Get': 'Obtén',
  'together': 'juntos',
  'Share your invite link. When a friend signs up and completes their first scan, you both get 3 tokens — 6 in total. There’s no limit, so invite as many friends as you like.':
    'Comparte tu enlace de invitación. Cuando un amigo se registra y completa su primer escaneo, ambos reciben 3 fichas: 6 en total. No hay límite, así que invita a todos los amigos que quieras.',
  'Your invite link': 'Tu enlace de invitación',
  'Generating your link…': 'Generando tu enlace…',
  'Copied': 'Copiado',
  'Copy': 'Copiar',

  // ── Reuse scan popup ──
  'New project': 'Nuevo proyecto',
  'Start from your saved scan, or take a fresh selfie.':
    'Empieza desde tu escaneo guardado o toma una nueva selfie.',
  'Setting up…': 'Configurando…',
  'Use my selfie': 'Usar mi selfie',
  'Take a new selfie': 'Tomar una nueva selfie',
  'Reusing your scan is free — no token spent.':
    'Reutilizar tu escaneo es gratis: no se gasta ninguna ficha.',

  // ── Delete confirm ──
  'Delete this cut?': '¿Eliminar este corte?',
  'Are you sure you want to delete': '¿Seguro que quieres eliminar',
  'No, keep it': 'No, consérvalo',
  'Yes, delete': 'Sí, eliminar',

  // ── Titles / nav ──
  'My': 'Mis',
  'Cuts': 'Cortes',
  'Saved##title': 'Guardados',
  'home': 'inicio',
  'saved': 'guardados',
  'explore': 'explorar',
  'settings': 'ajustes',
  'all': 'todos',
  'recent': 'recientes',
  'find a style...': 'busca un estilo...',
  'Scan now': 'Escanea ahora',
  'new cut': 'nuevo corte',
  'Browse my cuts': 'Ver mis cortes',
  'your keepers go here': 'tus favoritos van aquí',
  'Nothing pinned yet. Tap the bookmark on any cut and it lands on this wall.':
    'Aún no has fijado nada. Toca el marcador en cualquier corte y aparecerá en este muro.',
  'sign in to see your keepers': 'inicia sesión para ver tus favoritos',
  'Your saved cuts live here. Sign in to bookmark styles and build your collection.':
    'Tus cortes guardados viven aquí. Inicia sesión para marcar estilos y crear tu colección.',
  'Pick a cut to show your barber a 360°': 'Elige un corte para mostrar a tu barbero un 360°',
  'Style it': 'Estilízalo',
  'you': 'tú',

  // ── Scan result / ScanResultPopup ──
  'Your scan': 'Tu escaneo',

  // ── Scan popup ──
  'Analyzing your look...': 'Analizando tu aspecto...',
  'Please allow up to 2 minutes while we build your 3D model':
    'Espera hasta 2 minutos mientras creamos tu modelo 3D',
  'Unknown error': 'Error desconocido',
  'Try again': 'Intentar de nuevo',
  'Retake photo': 'Volver a tomar la foto',
  "Let's meet you": 'Conozcámonos',
  'Take a selfie!': '¡Toma una selfie!',
  'Close scan dialog': 'Cerrar el diálogo de escaneo',
  'Set up!': '¡Configura!',
  'Choose a username': 'Elige un nombre de usuario',
  'Letters, numbers, and underscores only.': 'Solo letras, números y guiones bajos.',
  'e.g. freshcuts_mike': 'p. ej. freshcuts_mike',
  'Saving…': 'Guardando…',
  'Retake': 'Repetir',
  'Proceed': 'Continuar',
  'Make this your main selfie?': '¿Hacer esta tu selfie principal?',
  'Your main selfie is the one new projects start from. You can keep your current one if you prefer.':
    'Tu selfie principal es la base de los nuevos proyectos. Puedes conservar la actual si lo prefieres.',
  'No': 'No',
  'Yes': 'Sí',
  'the looking glass': 'el espejo',

  // ── Build phrases (processing) ──
  'Building model': 'Construyendo modelo',
  'Drawing blueprint': 'Dibujando plano',
  'Mapping your features': 'Mapeando tus rasgos',
  'Sculpting in 3D': 'Esculpiendo en 3D',
  'Tracing every angle': 'Trazando cada ángulo',
  'Shaping the geometry': 'Dando forma a la geometría',
  'Adding depth': 'Añadiendo profundidad',
  'Refining the mesh': 'Refinando la malla',
  'Smoothing the surface': 'Suavizando la superficie',
  'Polishing details': 'Puliendo detalles',
  'Aligning the lighting': 'Alineando la iluminación',
  'Almost there': 'Casi listo',

  // ── Live checklist ──
  'The barber’s checklist': 'La lista del barbero',
  'One face in frame': 'Un rostro en el encuadre',
  'Arm’s length away': 'A un brazo de distancia',
  'Facing forward': 'Mirando al frente',
  'Good, even light': 'Buena luz uniforme',
  'Holding still': 'Sin moverte',
  'Sit against a plain, solid-color wall with no bright window or lamp behind your head — it keeps your hair sharp for the 3D model!':
    'Colócate frente a una pared lisa de color sólido, sin ventanas brillantes ni lámparas detrás de tu cabeza: así tu cabello se mantiene nítido para el modelo 3D.',

  // ── Pricing page ──
  'back': 'volver',
  'pricing': 'precios',
  'See yourself in the cut before you sit in the chair.':
    'Mírate con el corte antes de sentarte en la silla.',
  'avg barber visit': 'visita promedio al barbero',
  '1 AI look': '1 estilo con IA',
  'popular': 'popular',
  'one-time purchase · no subscription · secured by stripe':
    'compra única · sin suscripción · protegido por stripe',
  // Checkout failures (lib/checkout.ts + the Stripe route, shown via t()).
  'Couldn’t open checkout. Check your connection and try again.':
    'No se pudo abrir el pago. Revisa tu conexión e inténtalo de nuevo.',
  'Your session expired — sign in again, then retry.':
    'Tu sesión expiró: inicia sesión de nuevo y vuelve a intentarlo.',
  'Couldn’t start checkout — the payment service didn’t respond. Try again in a moment.':
    'No se pudo iniciar el pago: el servicio de pagos no respondió. Inténtalo de nuevo en un momento.',
  'Dismiss': 'Cerrar',
  'Free': 'Gratis',
  'Starter': 'Inicial',
  'Popular': 'Popular',
  'Pro': 'Pro',
  'forever': 'para siempre',
  'one-time': 'pago único',
  'Prebaked styles': 'Estilos prediseñados',
  '8 AI looks': '8 estilos con IA',
  '50 AI looks': '50 estilos con IA',
  '200 AI looks': '200 estilos con IA',
  'Start free': 'Empezar gratis',
  'Try 8 looks': 'Probar 8 estilos',
  'Get 50 looks': 'Obtener 50 estilos',
  'Get 200 looks': 'Obtener 200 estilos',
  'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.':
    'Explora más de 30 estilos seleccionados por expertos renderizados en tu escaneo 3D: sin generación, sin costo nunca.',
  '8 custom renders for less than a buck. Test a fade, a crop, and a taper before your next appointment.':
    '8 renders personalizados por menos de un dólar. Prueba un fade, un crop y un taper antes de tu próxima cita.',
  '50 looks to explore. Find what works for your face shape, then walk in with a reference photo.':
    '50 estilos para explorar. Encuentra lo que va con tu rostro y llega con una foto de referencia.',
  'Serious about your hair. 200 looks at 7.5¢ each — experiment until you find a signature style.':
    'En serio con tu cabello. 200 estilos a 7.5¢ cada uno: experimenta hasta encontrar tu estilo distintivo.',

  // ── Free-for-limited-time mode ──
  'Status': 'Estado',
  'Limited time': 'Tiempo limitado',
  'limited time': 'tiempo limitado',
  'Every look is on the house for a limited time — try a fade, a crop, and a taper, all free.':
    'Cada look corre por cuenta de la casa por tiempo limitado: prueba un fade, un crop y un taper, todo gratis.',
  'Everything’s free right now — make as many looks as you like, on the house.':
    'Todo es gratis ahora mismo: crea todos los looks que quieras, por cuenta de la casa.',
  'ShapeUp is completely free!': '¡ShapeUp es completamente gratis!',
  'We believe everyone should be able to explore their hairstyles at no cost. Because it costs us some money to run, we may add options to donate, but no payment. Try on as many hairstyles as you want and tell us what you think!':
    'Creemos que todo el mundo debería poder explorar sus peinados sin coste alguno. Como mantenerlo nos cuesta algo de dinero, es posible que añadamos opciones para donar, pero nunca pagos obligatorios. ¡Prueba todos los peinados que quieras y dinos qué te parece!',

  // ── Phone-bonus ribbon + modal ──
  'Free generations offer': 'Oferta de generaciones gratis',
  'Add your phone number and get': 'Agrega tu número de teléfono y obtén',
  '{n} free generations': '{n} generaciones gratis',
  'one tap, fully secure': 'un toque, totalmente seguro',
  'Claim +{n}': 'Reclamar +{n}',
  'Dismiss offer': 'Descartar oferta',
  '+{n} generations added!': '¡+{n} generaciones agregadas!',
  'Get {n} free generations': 'Obtén {n} generaciones gratis',
  'Verify your phone number and we’ll drop {n} generations into your account. We only use it to keep the bonus fair — no spam, ever.':
    'Verifica tu número de teléfono y agregaremos {n} generaciones a tu cuenta. Solo lo usamos para que el bono sea justo: nunca spam.',
  'Enter the 6-digit code we just texted you.': 'Ingresa el código de 6 dígitos que te enviamos por SMS.',
  'Phone number': 'Número de teléfono',
  'Include your country code, e.g. +1.': 'Incluye tu código de país, p. ej. +1.',
  'Verification code': 'Código de verificación',
  'They’re in your balance now. Go try a new look!': 'Ya están en tu saldo. ¡Prueba un nuevo look!',
  'Text me a code': 'Envíame un código',
  'Sending…': 'Enviando…',
  'Verify & claim +{n}': 'Verificar y reclamar +{n}',
  'Use a different number': 'Usar otro número',
  'Enter a valid phone number, including country code.': 'Ingresa un número de teléfono válido, con código de país.',
  "Couldn't send the code. Check the number and try again.": 'No se pudo enviar el código. Revisa el número e inténtalo de nuevo.',
  'Enter the code we texted you.': 'Ingresa el código que te enviamos.',
  'That code was incorrect or expired. Try again.': 'Ese código es incorrecto o expiró. Inténtalo de nuevo.',
  "Couldn't grant your bonus. Please try again.": 'No se pudo otorgar tu bono. Inténtalo de nuevo.',
  "Couldn't reach the server. Please try again.": 'No se pudo conectar con el servidor. Inténtalo de nuevo.',

  // ── Landing page ──
  'dashboard': 'panel',
  'Completely Free For Everyone · 3D Preview in 60 Seconds':
    'Completamente gratis para todos · Vista 3D en 60 segundos',
  'see it first.': 'míralo primero.',
  'love': 'ámalo',
  'it more.': 'aún más.',
  'Take one selfie. See 10+ haircuts on your actual 3D face.':
    'Toma una selfie. Mira más de 10 cortes en tu rostro 3D real.',
  'Walk into the barber knowing exactly what you want.':
    'Llega al barbero sabiendo exactamente lo que quieres.',
  'sound familiar?': '¿te suena familiar?',
  'You describe it.': 'Tú lo describes.',
  'They hear something different.': 'Ellos entienden algo distinto.',
  'You walk out of the barber disappointed — not because your barber was bad, but because there was no way to show exactly what you meant.':
    'Sales del barbero decepcionado, no porque tu barbero fuera malo, sino porque no había forma de mostrar exactamente lo que querías.',
  '~6 weeks': '~6 semanas',
  'to grow back a bad cut': 'para que crezca un mal corte',
  'A bad cut takes time to go away. Hair grows about half an inch a month.':
    'Un mal corte tarda en desaparecer. El cabello crece alrededor de un centímetro al mes.',
  '$45+ a visit': '$45+ por visita',
  'no preview, full commitment': 'sin vista previa, compromiso total',
  'You bind yourself to paying before you see anything, with no refunds :(':
    'Te comprometes a pagar antes de ver nada, sin reembolsos :(',
  '1 in 3': '1 de cada 3',
  "leave wishing they'd said more": 'se van deseando haber dicho más',
  "The cut isn't what you wanted. Yet you stay quiet in the chair.":
    'El corte no es el que querías. Aun así te quedas callado en la silla.',
  'We show you how any hairstyle looks on your face. Then, we give your barber the steps to make it happen.':
    'Te mostramos cómo se ve cualquier peinado en tu rostro. Luego le damos a tu barbero los pasos para lograrlo.',
  '60 secs': '60 seg',
  'SCAN TO 3D PREVIEW': 'DEL ESCANEO A LA VISTA 3D',
  'Just one minute from selfie to full 3D model.':
    'Solo un minuto de la selfie al modelo 3D completo.',
  '1 selfie': '1 selfie',
  'ALL YOU NEED': 'TODO LO QUE NECESITAS',
  'One photo is all it takes. Help us secure the best cut for you.':
    'Basta una foto. Ayúdanos a conseguir el mejor corte para ti.',
  'FOR EVERY HAIRSTYLE': 'PARA CADA PEINADO',
  'See yourself in as many cuts as you want — on the house, for a limited time.':
    'Verte en todos los cortes que quieras: por cuenta de la casa, por tiempo limitado.',
  'how it': 'cómo',
  'works': 'funciona',
  'This demo is live — send a message and try it yourself.':
    'Esta demostración está en vivo: envía un mensaje y pruébalo tú mismo.',
  'Selfie': 'Selfie',
  '30 seconds': '30 segundos',
  'just one selfie': 'solo una selfie',
  'Describe': 'Describe',
  'text it like a friend': 'escríbelo como a un amigo',
  'tap send — step 3 updates live': 'toca enviar — el paso 3 se actualiza en vivo',
  'Show your barber': 'Muéstrale a tu barbero',
  'your 3D preview, live': 'tu vista 3D, en vivo',
  'Ready to see your next cut?': '¿Listo para ver tu próximo corte?',
  'Explore My Best Hairstyles': 'Explora mis mejores peinados',
  'takes about 60 seconds · no account required':
    'toma unos 60 segundos · no requiere cuenta',
  'Get a glimpse of all': 'Vislumbra todo lo que',
  'could be.': 'podrías ser.',
  'clean & sharp': 'limpio y definido',
  'textured top': 'parte superior texturizada',
  'volume & flow': 'volumen y movimiento',
  'low maintenance': 'bajo mantenimiento',
  'effortless cool': 'estilo sin esfuerzo',
  'versatile classic': 'clásico versátil',
  '1 haircut generation': '1 generación de corte',
  '8 haircut generations': '8 generaciones de corte',
  '50 haircut generations': '50 generaciones de corte',
  '200 haircut generations': '200 generaciones de corte',
  'Explorer': 'Explorador',
  'Pick your style.': 'Elige tu estilo.',
  'Try It For Yourself': 'Pruébalo tú mismo',
  'takes about 60 seconds': 'toma unos 60 segundos',
  'Your photo stays private': 'Tu foto se mantiene privada',
  'We never sell or share your scan. Delete your data anytime from settings.':
    'Nunca vendemos ni compartimos tu escaneo. Elimina tus datos cuando quieras desde la configuración.',
  'AI trained on real cuts': 'IA entrenada con cortes reales',
  '3D facial mesh and strand-level simulation built from real barbershop styles.':
    'Malla facial 3D y simulación a nivel de mechón creadas a partir de estilos reales de barbería.',
  'Free to try, no risk': 'Gratis para probar, sin riesgo',
  'Your first previews are completely free. Pay only if you love the results.':
    'Tus primeras vistas previas son totalmente gratis. Paga solo si te encantan los resultados.',
  'Privacy': 'Privacidad',
  'Terms': 'Términos',
  'Biometric notice': 'Aviso biométrico',
  'Delete my data': 'Eliminar mis datos',
  'create your account': 'crea tu cuenta',
  'sign in to purchase': 'inicia sesión para comprar',
  'Start exploring.': 'Empieza a explorar.',
  'One step away.': 'A un paso.',

  // ── SignUpWidget (auth) ──
  'Go to dashboard': 'Ir al panel',
  'Check your inbox': 'Revisa tu bandeja de entrada',
  'We sent a 6-digit code to {email}': 'Enviamos un código de 6 dígitos a {email}',
  'Verify': 'Verificar',
  'Verifying…': 'Verificando…',
  'Two-factor authentication': 'Autenticación de dos factores',
  'Enter the code sent to your phone': 'Ingresa el código enviado a tu teléfono',
  'Enter the code sent to {email}': 'Ingresa el código enviado a {email}',
  'One sec…': 'Un momento…',
  'Continue with email': 'Continuar con correo',
  'or': 'o',
  'Continue with Google': 'Continuar con Google',
  'password': 'contraseña',
  'Free to start · No credit card · By continuing, you agree to the':
    'Gratis para empezar · Sin tarjeta de crédito · Al continuar, aceptas los',
  'and': 'y',
  'Privacy Policy': 'Política de privacidad',
  // auth error messages (translated at render via t(error))
  'Sign-in is not configured for this deployment.':
    'El inicio de sesión no está configurado para esta implementación.',
  'Sign-in is still loading. Try again in a moment.':
    'El inicio de sesión aún se está cargando. Inténtalo de nuevo en un momento.',
  'Wrong password — try again.': 'Contraseña incorrecta: inténtalo de nuevo.',
  'This password was found in a data breach. Please choose a different one.':
    'Esta contraseña apareció en una filtración de datos. Elige una diferente.',
  'This account was created with Google. Use "Continue with Google" to sign in.':
    'Esta cuenta se creó con Google. Usa "Continuar con Google" para iniciar sesión.',
  'Your account has been suspended. Contact support for help.':
    'Tu cuenta ha sido suspendida. Contacta a soporte para obtener ayuda.',
  'Too many attempts — please wait a moment and try again.':
    'Demasiados intentos: espera un momento e inténtalo de nuevo.',
  "You're already signed in.": 'Ya has iniciado sesión.',
  'Please enter both your email and password.':
    'Ingresa tu correo y tu contraseña.',
  'No account found with that email.':
    'No se encontró ninguna cuenta con ese correo.',
  'Sign-in incomplete — please try again.':
    'Inicio de sesión incompleto: inténtalo de nuevo.',
  'Sign-up failed — please try again.':
    'El registro falló: inténtalo de nuevo.',
  'Password is too weak — use at least 8 characters with a mix of letters and numbers.':
    'La contraseña es demasiado débil: usa al menos 8 caracteres con una mezcla de letras y números.',
  'An account with this email already exists. Try signing in instead.':
    'Ya existe una cuenta con este correo. Intenta iniciar sesión.',
  'Invalid code — try again': 'Código inválido: inténtalo de nuevo',
  'Verification failed — please try again.':
    'La verificación falló: inténtalo de nuevo.',
  'Google sign-in failed': 'Error al iniciar sesión con Google',

  // ── PricingPopup ──
  'out of tokens': 'sin fichas',
  'top up your cuts': 'recarga tus cortes',
  'Get more to keep the fresh cuts coming.':
    'Consigue más para seguir con los cortes frescos.',

  // ── Studio ──
  'Error — check console': 'Error — revisa la consola',
  'Building your 3D model…': 'Construyendo tu modelo 3D…',
  'We infer shape, hairline & proportions from your photos — a great likeness, not a measurement.':
    'Inferimos la forma, la línea del cabello y las proporciones a partir de tus fotos: un gran parecido, no una medición.',
  'The barber’s': 'Del barbero',
  'Toolbox': 'Caja de herramientas',
  'new request': 'nueva solicitud',
  'Render in 3D': 'Renderizar en 3D',
  'Voice': 'Voz',
  'Enter your desired hairstyle in the toolbox!':
    '¡Escribe el peinado que deseas en la caja de herramientas!',
  'Hair Parameters': 'Parámetros del cabello',
  'Hair length': 'Largo del cabello',
  'Width': 'Ancho',
  'Ponytail-ness': 'Nivel de coleta',
  'Density': 'Densidad',
  'Wavyness': 'Ondulación',
  'Parting': 'Raya',
  'live measurements': 'medidas en vivo',
  'auto': 'auto',
  'take it to your barber': 'llévaselo a tu barbero',
  'Barber’s order': 'Orden del barbero',
  'preset': 'preajuste',
  'type': 'tipo',
  'Project not found': 'Proyecto no encontrado',
  'the toolbox': 'la caja de herramientas',
  'THE': 'EL',
  'studio': 'estudio',
  'live · 3d sculpt': 'en vivo · escultura 3d',
  'Rendering your barber video': 'Renderizando tu video de barbero',
  'Hide photo': 'Ocultar foto',
  'Show photo': 'Mostrar foto',

  // ── EditPanel (toolbox) ──
  'Apply': 'Aplicar',
  'Apply hair edit request': 'Aplicar solicitud de edición de cabello',
  'Hair editor controls': 'Controles del editor de cabello',
  'Styling…': 'Estilizando…',
  'Rendering…': 'Renderizando…',
  'FRESH CUT': 'CORTE FRESCO',
  'shapeup approved': 'aprobado por shapeup',
  'oops': 'ups',
  'More trending cuts': 'Más cortes en tendencia',
  'Sketching the cut progress': 'Progreso del bosquejo del corte',
  'Sculpting in 3D progress': 'Progreso del esculpido en 3D',
  // prompt placeholders
  '"Messy taper fade, please."': '"Un taper fade despeinado, por favor."',
  '"Take the sides down to a #2."': '"Baja los lados a un #2."',
  '"Keep the length, just add texture."': '"Conserva el largo, solo añade textura."',
  '"Mid fade, clean line-up."': '"Mid fade, perfilado limpio."',
  '"Curly on top, skin fade sides."': '"Rizado arriba, skin fade a los lados."',
  // chatter — sketch
  'Sketching the cut…': 'Bosquejando el corte…',
  'Reading your curl pattern…': 'Leyendo tu patrón de rizos…',
  'Combing through the details…': 'Repasando los detalles…',
  'Eyeballing the blend…': 'Calibrando el degradado…',
  // chatter — hairstep
  'Sculpting it in 3D…': 'Esculpiéndolo en 3D…',
  'Setting every strand…': 'Colocando cada mechón…',
  'Spinning the chair around…': 'Girando la silla…',
  'Holding up the mirror…': 'Levantando el espejo…',

  // ── Barber card (public /b/<slug>) ──
  'Try on {cut}': 'Pruébate {cut}',
  'Links': 'Enlaces',
  'This barber hasn’t added recommendations yet.':
    'Este barbero aún no ha agregado recomendaciones.',
  'Explore the best hairstyles for you': 'Explora los mejores peinados para ti',
  'All': 'Todos',
  'Tap any cut to see it on your own head.':
    'Toca cualquier corte para verlo en tu propia cabeza.',
  'Virtual try-on': 'Prueba virtual',
  'Fitting room by ShapeUp': 'Probador de ShapeUp',
  'Photo of {name}': 'Foto de {name}',
  'Services': 'Servicios',
  'Filter styles': 'Filtrar estilos',
  'Barber’s pick': 'Recomendación del barbero',
  'Barber’s picks': 'Recomendaciones del barbero',
  'Men’s': 'Hombres',
  'Women’s': 'Mujeres',
  'What are we doing today?': '¿Qué hacemos hoy?',
  'Keep it familiar, or discover the cuts that suit you best.':
    'Mantén lo de siempre, o descubre los cortes que mejor te quedan.',
  'Just doing a trim.': 'Solo un recorte.',
  'Show me my best hairstyles': 'Muéstrame mis mejores peinados',
  'From the menu': 'Del menú',
  'Tap a cut to try it on': 'Toca un corte para probártelo',
  'Sure. What kind of trim?': 'Claro. ¿Qué tipo de recorte?',
  'Leave a note for your barber': 'Deja una nota para tu barbero',
  'Clean up the sides, keep the length…': 'Limpia los lados, mantén el largo…',
  'Show it to them from the chair — nothing to send.':
    'Muéstrasela desde la silla — no hay nada que enviar.',
  'While you wait — see your best hairstyles':
    'Mientras esperas — mira tus mejores peinados',
  'Finding the cuts that fit you.': 'Buscando los cortes que te quedan.',
  'Preparing the selfie camera': 'Preparando la cámara para selfies',

  // ── Barber try-on (embedded selfie -> generate -> send flow) ──
  'Try it on yourself': 'Pruébalo en ti mismo',
  'All styles': 'Todos los estilos',
  'Take a selfie': 'Toma una selfie',
  'Your photo': 'Tu foto',
  '{n} ahead of you': '{n} delante de ti',
  'Let’s see how it looks on you!': '¡Veamos cómo te queda!',
  'Preparing your preview': 'Preparando tu vista previa',
  'Applying the hairstyle': 'Aplicando el peinado',
  'Building your 3D look': 'Creando tu look en 3D',
  'Checking your photo…': 'Revisando tu foto…',
  'Photo looks good': 'La foto se ve bien',
  'Keep your full head in frame': 'Mantén toda la cabeza dentro del encuadre',
  'Use this photo': 'Usar esta foto',
  'Camera unavailable — upload a photo instead.':
    'La cámara no está disponible — sube una foto.',
  'Take the photo': 'Tomar la foto',
  'Upload a photo': 'Subir una foto',
  'View controls': 'Controles de vista',
  'Before': 'Antes',
  'Reset view': 'Restablecer vista',
  'Retake selfie': 'Tomar otra selfie',
  'Your original photo': 'Tu foto original',
  'Drag to rotate · scroll to zoom': 'Arrastra para girar · desliza para acercar',
  'Book with {name}': 'Reservar con {name}',
  'One quick sign-in — it’s how we send you the result and let this barber know what you want.':
    'Un inicio de sesión rápido — así te enviamos el resultado y le mostramos a este barbero lo que quieres.',
  'Uploading…': 'Subiendo…',
  'Take or choose a photo': 'Toma o elige una foto',
  'Editing your photo…': 'Editando tu foto…',
  'Building your 3D cut…': 'Construyendo tu corte en 3D…',
  'In line for the 3D render — {n} ahead of you…': 'En la fila para el render 3D — {n} delante de ti…',
  'Drag to rotate': 'Arrastra para rotar',
  'The 3D render didn’t come through, but here’s your photo.':
    'El render 3D no llegó, pero aquí tienes tu foto.',
  'You, wearing {cut}': 'Tú, con {cut}',
  'Shorter on the sides, keep the top…': 'Más corto en los lados, conserva el top…',
  'Describe a change': 'Describe un cambio',
  'Go': 'Ir',
  'Send this to my barber': 'Enviar esto a mi barbero',
  'Sent! They’ll see exactly what you want before you sit down.':
    '¡Enviado! Verán exactamente lo que quieres antes de que te sientes.',
  'Sent to {name}’s ShapeUp inbox — they’ll see it before your cut.':
    'Enviado a la bandeja de ShapeUp de {name} — lo verá antes de tu corte.',
  'Couldn’t send that — screenshot this and show them in the chair instead.':
    'No se pudo enviar — toma una captura de pantalla y muéstrasela en la silla.',
  'Phone (optional)': 'Teléfono (opcional)',
  'That edit didn’t work — try a different photo or cut.':
    'Ese cambio no funcionó — prueba con otra foto o corte.',
  'Something went wrong. Check your connection and try again.':
    'Algo salió mal. Revisa tu conexión e inténtalo de nuevo.',
  'Couldn’t upload that photo — try again.': 'No se pudo subir esa foto — inténtalo de nuevo.',

  // ── Barber booking (/b/<slug> scheduler) ──
  'Book a time': 'Reservar una hora',
  'Book a chair': 'Reserva tu silla',
  '{city} time': 'hora de {city}',
  'No open times in the next two weeks — reach out directly.':
    'No hay horarios libres en las próximas dos semanas — contáctalo directamente.',
  'Pick a day': 'Elige un día',
  'Pick a time': 'Elige una hora',
  'One quick sign-in so {name} knows the booking is real.':
    'Un inicio de sesión rápido para que {name} sepa que la reserva es real.',
  'Service (optional)': 'Servicio (opcional)',
  'Just a cut': 'Solo un corte',
  'Booking…': 'Reservando…',
  'Book {time}': 'Reservar {time}',
  'You’re booked.': 'Reserva confirmada.',
  'Add to Google Calendar': 'Agregar a Google Calendar',
  'Apple / Outlook (.ics)': 'Apple / Outlook (.ics)',
  '{name} got the details — just show up.': '{name} ya tiene los detalles — solo preséntate.',
  'Haircut with {name}': 'Corte con {name}',
  'Cut I tried on: {cut}': 'Corte que me probé: {cut}',

  // ── Barber builder: appointments ──
  'Appointments': 'Citas',
  'Let clients book times on my card': 'Permitir que los clientes reserven horas en mi tarjeta',
  'Clients pick a real open slot; you both get a confirmation with a calendar invite. No other app needed.':
    'Los clientes eligen un horario libre real; ambos reciben una confirmación con invitación de calendario. Sin otra app.',
  'Timezone': 'Zona horaria',
  'Slot length': 'Duración del turno',
  '{n} minutes': '{n} minutos',
  'Sunday': 'Domingo',
  'Monday': 'Lunes',
  'Tuesday': 'Martes',
  'Wednesday': 'Miércoles',
  'Thursday': 'Jueves',
  'Friday': 'Viernes',
  'Saturday': 'Sábado',
  'Opens': 'Abre',
  'Closes': 'Cierra',
  'Closed': 'Cerrado',
  "That timezone isn't recognized.": 'Esa zona horaria no se reconoce.',
  'Pick a slot length from the list.': 'Elige una duración de turno de la lista.',
  'At most one window per day of the week.': 'Como máximo un horario por día de la semana.',
  'Days must be Sunday through Saturday.': 'Los días deben ser de domingo a sábado.',
  'Hours must look like 09:00.': 'Las horas deben tener el formato 09:00.',
  'Each day must open before it closes.': 'Cada día debe abrir antes de cerrar.',
  'Add at least one open day to take bookings.':
    'Agrega al menos un día abierto para recibir reservas.',
  'Upcoming appointments': 'Próximas citas',
  'Nothing on the books yet — slots are live on your card.':
    'Aún no hay citas — los horarios ya están activos en tu tarjeta.',
  'Cancel {name}’s appointment? They’ll be emailed that the time is off.':
    '¿Cancelar la cita de {name}? Se le avisará por correo que la hora quedó libre.',
  'Cancelling…': 'Cancelando…',
  'Client requests': 'Solicitudes de clientes',
  'Cuts clients sent from your card — what they want before they sit down.':
    'Cortes que los clientes enviaron desde tu tarjeta — lo que quieren antes de sentarse.',
  'Client preview: {cut}': 'Vista previa del cliente: {cut}',
  'View 360°': 'Ver 360°',
  '{n}m ago': 'hace {n} min',
  '{n}h ago': 'hace {n} h',
  '{n}d ago': 'hace {n} días',

  // ── Barber dashboard settings (the header gear) ──
  'Also what the chair shows your client': 'También lo que la silla muestra a tu cliente',
  'Clock': 'Reloj',
  'How appointment times read': 'Cómo se leen las horas de las citas',
  '12h': '12 h',
  '24h': '24 h',
  'Card is live': 'Tarjeta en vivo',
  'Clients can open /b/{slug}': 'Los clientes pueden abrir /b/{slug}',
  'No card yet': 'Aún no tienes tarjeta',
  'Taking appointments': 'Aceptando citas',
  'Booking on your card': 'Reservas activas en tu tarjeta',
  'Set working hours on your card first': 'Primero define tu horario en la tarjeta',
  'Set your working hours on your card first.': 'Primero define tu horario en la tarjeta.',
  'Improve the model': 'Mejorar el modelo',
  'Chair takes help train future cuts': 'Las tomas de la silla ayudan a entrenar futuros cortes',
  'Edit card': 'Editar tarjeta',

  // ── Barber builder (/barber) ──
  'Build your barber card': 'Crea tu tarjeta de barbero',
  'Sign in to claim your link and print your mirror QR.':
    'Inicia sesión para reclamar tu enlace e imprimir el QR de tu espejo.',
  'Your barber card': 'Tu tarjeta de barbero',
  'Profile photo': 'Foto de perfil',
  'Profile': 'Perfil',
  'Upload': 'Subir',
  'Add a profile photo': 'Agregar una foto de perfil',
  'Replace your profile photo': 'Reemplazar tu foto de perfil',
  'Replace': 'Reemplazar',
  'Clients trust a face. Square crop, up to 8 MB.':
    'Los clientes confían en un rostro. Recorte cuadrado, hasta 8 MB.',
  'That file isn’t an image — try a JPG or PNG.':
    'Ese archivo no es una imagen — prueba con JPG o PNG.',
  'That photo is too large — keep it under 8 MB.':
    'Esa foto es demasiado grande — debe pesar menos de 8 MB.',
  'Remove your profile photo?': '¿Quitar tu foto de perfil?',
  'Business details': 'Detalles del negocio',
  'Location': 'Ubicación',
  'Telegraph Ave, Oakland': 'Telegraph Ave, Oakland',
  'shown under your name': 'se muestra debajo de tu nombre',
  'Hours': 'Horario',
  'Tue–Sat · 9–6': 'Mar–Sáb · 9–6',
  'Services & pricing': 'Servicios y precios',
  'Add a service': 'Agregar un servicio',
  'Service name': 'Nombre del servicio',
  'Skin fade': 'Degradado al ras',
  'Price': 'Precio',
  'Remove this service?': '¿Quitar este servicio?',
  'Booking & links': 'Reservas y enlaces',
  'Move up': 'Mover arriba',
  'Move down': 'Mover abajo',
  'Remove this link from your card?': '¿Quitar este enlace de tu tarjeta?',
  'Notifications': 'Notificaciones',
  'Recommended cuts': 'Cortes recomendados',
  'These lead your card as “Barber’s picks” — clients tap them to try them on.':
    'Estos aparecen primero como “Recomendaciones del barbero” — los clientes los tocan para probárselos.',
  'Unsaved changes': 'Cambios sin guardar',
  'Insights': 'Estadísticas',
  'This week': 'Esta semana',
  'vs last week': 'vs. la semana pasada',
  'Booking taps': 'Toques en reservas',
  'Previews finished': 'Vistas previas completadas',
  'Most-tried styles': 'Estilos más probados',
  'Clients often leave before finishing a preview — remind them it takes under a minute.':
    'Los clientes suelen salir antes de terminar la vista previa — recuérdales que tarda menos de un minuto.',
  'Scans are up from last week ({a} → {b}).':
    'Los escaneos subieron desde la semana pasada ({a} → {b}).',
  'Your booking link got {n} taps this week.':
    'Tu enlace de reservas recibió {n} toques esta semana.',
  '{n} clients joined ShapeUp through your card.':
    '{n} clientes se unieron a ShapeUp mediante tu tarjeta.',
  '“{cut}” is your most-tried style.': '“{cut}” es tu estilo más probado.',
  'A free page for your clients — and a fitting room that shows them the cut on their own head.':
    'Una página gratis para tus clientes — y un probador que les muestra el corte en su propia cabeza.',
  'Your link': 'Tu enlace',
  'Your name': 'Tu nombre',
  'Name': 'Nombre',
  'Shop': 'Barbería',
  'Bio': 'Biografía',
  'Ten years on Telegraph Ave. Walk-ins welcome.':
    'Diez años en la Av. Telegraph. Sin cita también.',
  'Notify me at': 'Notifícame en',
  'private — never shown on your card': 'privado — nunca se muestra en tu tarjeta',
  'When a client picks a cut on your card, we’ll email you the result and their contact info — so you know exactly what to do before they sit down.':
    'Cuando un cliente elige un corte en tu tarjeta, te enviamos por correo el resultado y su contacto — para que sepas exactamente qué hacer antes de que se siente.',
  'Link type': 'Tipo de enlace',
  'Remove': 'Quitar',
  'Label (e.g. My portfolio)': 'Etiqueta (ej. Mi portafolio)',
  'Link label': 'Etiqueta del enlace',
  'Cuts you do': 'Cortes que haces',
  'Clients tap these to try them on. Pick your go-to cuts.':
    'Los clientes los tocan para probarlos. Elige tus cortes habituales.',
  'Live': 'En vivo',
  'Save changes': 'Guardar cambios',
  'Publish card': 'Publicar tarjeta',
  'Checking…': 'Comprobando…',
  'Available': 'Disponible',
  'That name is taken.': 'Ese nombre ya está tomado.',
  'QR code for your card': 'Código QR de tu tarjeta',
  'Your card is live': 'Tu tarjeta está en vivo',
  'Copied!': '¡Copiado!',
  'Download mirror card': 'Descargar tarjeta de espejo',
  'View card ↗': 'Ver tarjeta ↗',
  'Print it and tape it to your mirror. Clients scan it from the chair.':
    'Imprímela y pégala en tu espejo. Los clientes la escanean desde la silla.',
  'Scans': 'Escaneos',
  'Try-ons': 'Pruebas',
  'Link taps': 'Toques de enlace',
  'Clients joined': 'Clientes registrados',

  // ── For barbers (pitch page) ──
  'Build your card': 'Crea tu tarjeta',
  'Free for barbers': 'Gratis para barberos',
  'Your clients stop describing the cut.': 'Tus clientes dejan de describir el corte.',
  'They show you.': 'Te lo muestran.',
  'A free page for your chair — booking, socials, Venmo, all in one link — with a fitting room built in. A client scans the QR on your mirror, taps a cut, and sees it on their own head. No more “a little off the top.”':
    'Una página gratis para tu silla — reservas, redes, Venmo, todo en un enlace — con probador incluido. Un cliente escanea el QR de tu espejo, toca un corte y lo ve en su propia cabeza. Se acabó el “un poquito de arriba”.',
  'Build your card — free': 'Crea tu tarjeta — gratis',
  'Claim your link': 'Reclama tu enlace',
  'Pick your name — tryshapeup.cc/b/you. Add booking, Instagram, Venmo, call and text. Free, forever.':
    'Elige tu nombre — tryshapeup.cc/b/tu. Agrega reservas, Instagram, Venmo, llamadas y mensajes. Gratis, para siempre.',
  'Add the cuts you do': 'Agrega los cortes que haces',
  'Choose your go-to styles. Clients tap one and see it on their own head — before you pick up the clippers.':
    'Elige tus estilos habituales. Los clientes tocan uno y lo ven en su propia cabeza — antes de que tomes la máquina.',
  'Tape the QR to your mirror': 'Pega el QR en tu espejo',
  'Print the card. Every client in your chair scans it, shows you exactly what they want, and lands on your page.':
    'Imprime la tarjeta. Cada cliente en tu silla la escanea, te muestra exactamente lo que quiere y llega a tu página.',
  'It’s the free tool your clients actually want.':
    'Es la herramienta gratis que tus clientes realmente quieren.',
  'Every client who scans your QR and signs up is tracked back to you. Watch it on your dashboard.':
    'Cada cliente que escanea tu QR y se registra se atribuye a ti. Míralo en tu panel.',
  'Get started': 'Comenzar',

  // ── Chair mode (/chair) ──
  // Shop Spanish, not textbook Spanish: this is read aloud to a client sitting
  // in the chair, so the coaching lines are imperatives a barber would actually
  // say ("date la vuelta", not "por favor rote la cabeza").
  'Chair': 'Silla',
  'Chair mode': 'Modo silla',
  'My card': 'Mi tarjeta',
  'Next client': 'Siguiente cliente',
  '{n} left today': '{n} restantes hoy',
  'Live takes left today': 'Tomas en vivo restantes hoy',
  'Setting up your chair…': 'Preparando tu silla…',
  'Where should style references go?': '¿A dónde van las referencias de estilo?',
  'When a client approves a look, snapshots of it are emailed here. Set once for this shop.':
    'Cuando un cliente aprueba un look, las capturas se envían aquí por correo. Se configura una vez por local.',
  'Shop email': 'Correo del local',
  'Later': 'Después',
  'That doesn’t look like an email address.': 'Eso no parece una dirección de correo.',
  'Sign in with your barber account to run live try-ons in the chair.':
    'Inicia sesión con tu cuenta de barbero para hacer pruebas en vivo en la silla.',

  'Who’s in the chair?': '¿Quién está en la silla?',
  'Start': 'Empezar',
  'Starting…': 'Empezando…',
  'Give this client a name so the cut files under it.':
    'Ponle un nombre a este cliente para archivar el corte.',
  'That name’s too long.': 'Ese nombre es muy largo.',
  'Couldn’t start that client.': 'No se pudo abrir ese cliente.',

  // ── consent ──
  'Before we film': 'Antes de grabar',
  'We’ll film about 30 seconds of you in the chair and show your face with the haircut applied, so your barber can see it from every angle.':
    'Grabaremos unos 30 segundos tuyos en la silla y mostraremos tu cara con el corte aplicado, para que tu barbero lo vea desde todos los ángulos.',
  'The clip and the reference photos are saved to your barber’s account under your name. Ask them to delete it any time and it’s gone.':
    'El video y las fotos de referencia se guardan en la cuenta de tu barbero bajo tu nombre. Pídele que lo borre cuando quieras y se elimina.',
  'I agree — let’s see it': 'Acepto — vamos a verlo',
  'Let’s do it!': '¡Vamos allá!',
  'The chair, before any haircut is applied': 'La silla, antes de aplicar ningún corte',
  'Nothing running yet — the {n} seconds start when you pick a cut or say what you want.':
    'Aún no hay nada en marcha: los {n} segundos empiezan cuando eliges un corte o dices lo que quieres.',
  'Say what you want': 'Di lo que quieres',
  'No thanks': 'No, gracias',
  'Couldn’t save that. Try again.': 'No se pudo guardar. Inténtalo de nuevo.',

  // ── style ──
  'Pick a cut': 'Elige un corte',
  'Show fewer': 'Ver menos',
  'Full menu ({n} cuts)': 'Menú completo ({n} cortes)',
  'Full menu': 'Menú completo',
  Suggested: 'Sugeridos',
  'Why these?': '¿Por qué estos?',
  'Hide reasons': 'Ocultar motivos',
  '{n}% sure': '{n}% de certeza',
  'House favourite': 'Favorito de la casa',
  // Face-shape read — barber-facing only, never shown to the client.
  'Balanced##face': 'Equilibrado',
  Rounder: 'Más redondo',
  Longer: 'Más alargado',
  'Strong jaw': 'Mandíbula marcada',
  'Wider forehead': 'Frente más ancha',
  'Wide cheekbones': 'Pómulos anchos',
  // Why a cut was suggested — see src/lib/chair/recommend.ts.
  'Height on top lengthens a rounder face': 'El volumen arriba alarga una cara redonda',
  'Keeps height down so the face doesn’t read longer':
    'Mantiene el volumen bajo para no alargar más la cara',
  'Width at the sides balances a longer face':
    'El ancho en los lados equilibra una cara alargada',
  'Tight sides keep a rounder face from reading wider':
    'Los lados cerrados evitan que una cara redonda se vea más ancha',
  'A fringe shortens a longer face': 'El flequillo acorta una cara alargada',
  'An open forehead adds length to a rounder face':
    'La frente despejada alarga una cara redonda',
  'Blunt lines give a finer jaw definition':
    'Las líneas rectas definen una mandíbula más fina',
  'Soft texture instead of hard lines, against a strong jaw':
    'Textura suave en vez de líneas duras, para una mandíbula marcada',
  'Hair at the cheeks fills out a narrower chin':
    'El pelo en las mejillas rellena un mentón estrecho',
  'Keeps hair off an already strong jaw':
    'Deja libre una mandíbula que ya es marcada',
  'Width at the cheeks balances a wider forehead':
    'El ancho en las mejillas equilibra una frente ancha',
  'Keeps weight off the widest part of the face':
    'Quita volumen de la parte más ancha de la cara',
  'A fringe evens out the forehead': 'El flequillo equilibra la frente',
  'Leaves the forehead open': 'Deja la frente despejada',
  'Or describe it': 'O descríbelo',
  'Tighter on the sides, leave the fringe': 'Más corto a los lados, deja el flequillo',
  'Listening…': 'Escuchando…',
  'Dictate instead of typing': 'Dictar en vez de escribir',
  'Stop dictation': 'Detener el dictado',
  'Cancel dictation': 'Cancelar el dictado',
  'The mic is blocked — allow microphone access in the browser and try again.':
    'El micrófono está bloqueado: permite el acceso al micrófono en el navegador e inténtalo de nuevo.',
  'Couldn’t hear you — try the mic again.': 'No se te escuchó: prueba el micrófono de nuevo.',
  'Start the {n}s take': 'Empezar la toma de {n}s',
  'No takes left today': 'No quedan tomas hoy',

  // ── live ──
  'Live try-on': 'Prueba en vivo',
  'Live preview of the new cut': 'Vista en vivo del corte nuevo',
  'Getting the mirror ready…': 'Preparando el espejo…',
  'Switch camera': 'Cambiar cámara',
  'Switch the cut live': 'Cambiar el corte en vivo',
  'Stop early': 'Terminar antes',
  'Cancel take': 'Cancelar toma',
  '{n} seconds left in this take': 'Quedan {n} segundos de esta toma',
  'Look straight into the camera': 'Mira directo a la cámara',
  'Now start turning — slow and steady': 'Ahora empieza a girar — despacio y parejo',
  'Keep going, all the way around': 'Sigue, da la vuelta completa',
  'And back to the front': 'Y de vuelta al frente',
  'Couldn’t open the camera. Check the browser’s camera permission.':
    'No se pudo abrir la cámara. Revisa el permiso de cámara del navegador.',
  'Couldn’t reach the live model. Check the shop’s wifi.':
    'No se pudo conectar al modelo en vivo. Revisa el wifi del local.',
  'That’s every live take for today. They reset tomorrow morning.':
    'Se acabaron las tomas en vivo de hoy. Se reinician mañana por la mañana.',
  'Live takes are paused for this month.': 'Las tomas en vivo están pausadas este mes.',
  'Couldn’t start that take.': 'No se pudo empezar esa toma.',
  'That’s a lot of takes at once — give the mirror a minute, then go again.':
    'Muchas tomas seguidas — dale un minuto al espejo y vuelve a intentarlo.',
  'Your session timed out. Sign in again to keep going.':
    'Tu sesión expiró. Inicia sesión de nuevo para continuar.',
  'That’s a lot at once — give it a moment and try again.':
    'Eso es mucho de golpe — espera un momento e inténtalo de nuevo.',
  'This browser can’t record video. Try Chrome or Safari.':
    'Este navegador no puede grabar video. Prueba Chrome o Safari.',
  'The take played but didn’t save. The angles below still work.':
    'La toma se reprodujo pero no se guardó. Los ángulos de abajo siguen sirviendo.',

  // ── review ──
  'Review the take': 'Revisa la toma',
  'That’s {cut}. Is that it?': 'Ese es {cut}. ¿Así lo quieres?',
  'Yes — that’s the one': 'Sí — ese es',
  'Try another': 'Probar otro',

  // ── reference sheet ──
  'Nothing usable came out of that take.': 'Esa toma no dio nada aprovechable.',
  'Left profile': 'Perfil izquierdo',
  'Left ¾': 'Tres cuartos izquierdo',
  'Front': 'Frente',
  'Right ¾': 'Tres cuartos derecho',
  'Right profile': 'Perfil derecho',
  // Only the disambiguated key lives here; the bare 'Back' above is the nav
  // string, which would otherwise mistranslate the back-of-head angle.
  'Back##angle': 'Nuca',
  'Sideburn, ear line, left temple': 'Patilla, línea de la oreja, sien izquierda',
  'Sideburn, ear line, right temple': 'Patilla, línea de la oreja, sien derecha',
  'How the fade reads walking up': 'Cómo se ve el degradado de frente al acercarse',
  'Fringe, part, hairline': 'Flequillo, raya, línea del pelo',
  'Neckline, crown, weight line': 'Nuca, coronilla, línea de peso',
  'Filed under {name}': 'Archivado en {name}',
  '{n} reference angles saved. It’s on your card’s dashboard whenever you need it.':
    '{n} ángulos de referencia guardados. Están en el panel de tu tarjeta cuando los necesites.',
  'Open dashboard': 'Abrir panel',

  // ── dashboard panel ──
  'Chair clients': 'Clientes de la silla',
  'Live try-ons you ran in the chair, filed under each client’s name.':
    'Pruebas en vivo que hiciste en la silla, archivadas con el nombre de cada cliente.',
  'Nothing yet — open Chair Mode when your next client sits down.':
    'Nada aún — abre el Modo silla cuando se siente tu próximo cliente.',
  'Open Chair Mode →': 'Abrir Modo silla →',
  'No takes recorded for this client.': 'No hay tomas grabadas para este cliente.',
  'Approved': 'Aprobada',
  'Take': 'Toma',
  'Play the take': 'Ver la toma',
  '{angle} reference for {name}': 'Referencia {angle} de {name}',
  'Delete this client’s data': 'Borrar los datos de este cliente',
  'Erase {name}’s takes, photos and record? This can’t be undone.':
    '¿Borrar las tomas, fotos y el registro de {name}? Esto no se puede deshacer.',
  'Erase everything': 'Borrar todo',
  'Erasing…': 'Borrando…',
  'Keep': 'Conservar',
  // ── the live mirror on a barber card (BarberLiveTryOn) ──
  'Try it on live': 'Pruébalo en vivo',
  'Before the camera starts': 'Antes de encender la cámara',
  'We’ll film about 30 seconds of you and show your face with the haircut applied, live, so you can see it move.':
    'Grabaremos unos 30 segundos y te mostraremos tu cara con el corte aplicado, en vivo, para que veas cómo se mueve.',
  'The clip is saved to {name}’s ShapeUp account under your name. Ask them to delete it any time and it’s gone.':
    'El vídeo se guarda en la cuenta de ShapeUp de {name} con tu nombre. Pídeles que lo borren cuando quieras y desaparece.',

  // ── consent: what the 30 seconds are for, and the diagram under it ──
  'The next step will use the camera to style your hair. You have 30 seconds to explore which hairstyles fit you best! Use the prompt box and suggestions below to style.':
    'El siguiente paso usa la cámara para peinarte. ¡Tienes 30 segundos para explorar qué cortes te quedan mejor! Usa el cuadro de texto y las sugerencias de abajo para probar.',
  'A sketch of the next screen: your camera on the left, the same view with the haircut on the right, a prompt box under both, and cut suggestions below that.':
    'Un esquema de la siguiente pantalla: tu cámara a la izquierda, la misma imagen con el corte a la derecha, un cuadro de texto debajo de ambas y sugerencias de cortes más abajo.',
  'A sketch of the screen — not a preview of your result.':
    'Un esquema de la pantalla, no una vista previa de tu resultado.',
  'With the cut': 'Con el corte',
  'You##camera': 'Tú',
  'Live##camera': 'En vivo',
  'Couldn’t start that. Try again.': 'No se pudo iniciar. Inténtalo de nuevo.',
  'Your camera, before the haircut is applied': 'Tu cámara, antes de aplicar el corte',
  'Anything you want different?': '¿Quieres cambiar algo?',
  'Tighter on the sides, keep the fringe…': 'Más corto a los lados, deja el flequillo…',
  'The mirror’s had a busy day — try tomorrow': 'El espejo ha tenido un día ocupado: prueba mañana',
  'You can change the cut, or say what you want, while it’s running.':
    'Puedes cambiar el corte, o decir lo que quieres, mientras está en marcha.',
  'You, live, with the new cut': 'Tú, en vivo, con el corte nuevo',
  'Say it while you watch — “shorter on top”': 'Dilo mientras miras: “más corto arriba”',
  'Change the cut while it’s running': 'Cambia el corte mientras está en marcha',
  'Stop': 'Detener',
  'That’s the one': 'Ese es',
  'That’s {cut}. Send it to {name}?': 'Ese es {cut}. ¿Se lo enviamos a {name}?',
  'Send to {name}': 'Enviar a {name}',
  'Couldn’t send that — show them this clip in the chair instead.':
    'No se pudo enviar: enséñales este vídeo en la silla.',
  'Try another cut': 'Probar otro corte',
  'Preparing the live mirror': 'Preparando el espejo en vivo',
  'Clients often leave before finishing a take — tell them it’s 30 seconds and they can watch it live.':
    'Los clientes suelen irse antes de terminar una toma: recuérdales que son 30 segundos y que pueden verlo en vivo.',

  // ── chair: visit records & the last-time card ──
  'Last visit': 'Última visita',
  'Last time': 'La última vez',
  'Reference from the last visit': 'Referencia de la última visita',
  'No cut on file': 'Sin corte registrado',
  'Same again': 'Lo mismo otra vez',
  'For next time (optional)': 'Para la próxima (opcional)',
  'Quick facts': 'Datos rápidos',
  'Note for next time': 'Nota para la próxima',
  'Went 0.5 lower on the sides than usual': 'Bajamos 0,5 más de lo habitual a los lados',
  'Save note': 'Guardar nota',
  'Noted — it’ll be here next visit': 'Anotado: estará aquí en la próxima visita',
  'Taper': 'Degradado bajo',
  'Line up': 'Perfilado',
  'Beard trim': 'Arreglo de barba',
  'Scissors': 'Tijera',

  // ── barber dashboard (/barber tabs) ──
  'Card': 'Tarjeta',
  'Studio': 'Estudio',
  'Dashboard sections': 'Secciones del panel',
  'Open the chair': 'Abrir la silla',
  'Your barber dashboard': 'Tu panel de barbero',
  'Sign in to run the chair, keep every client’s reference shots, and manage your card.':
    'Inicia sesión para usar la silla, guardar las fotos de referencia de cada cliente y gestionar tu tarjeta.',
  'Today': 'Hoy',
  'Welcome': 'Bienvenido',
  'Set up your barber card first — it’s your public page, and it’s what the chair files clients under.':
    'Configura primero tu tarjeta de barbero: es tu página pública y donde la silla archiva a tus clientes.',
  'Set up my card': 'Configurar mi tarjeta',
  'The chair': 'La silla',
  'Live mirror, reference angles, filed under the client’s name — about a minute per customer.':
    'Espejo en vivo, ángulos de referencia, archivado a nombre del cliente: alrededor de un minuto por persona.',
  'Appointments today': 'Citas de hoy',
  'Nothing on the books today — walk-ins go straight to the chair.':
    'Nada agendado hoy: los clientes sin cita van directos a la silla.',
  'Booking is off. Turn it on in your card to take appointments here.':
    'Las reservas están desactivadas. Actívalas en tu tarjeta para recibir citas aquí.',
  'Seat in the chair': 'Sentar en la silla',
  'Recent clients': 'Clientes recientes',
  '{n} takes left today': 'Hoy quedan {n} tomas',
  'Search by name or phone': 'Buscar por nombre o teléfono',
  'Search clients': 'Buscar clientes',
  'No client matches “{q}”.': 'Ningún cliente coincide con «{q}».',
  'Notes on file': 'Notas archivadas',
  'Walk-in': 'Sin cita',
  'That client isn’t in your book any more.': 'Ese cliente ya no está en tu libreta.',
  'All clients': 'Todos los clientes',
  'Client since {date}': 'Cliente desde {date}',
  'Joined from your card': 'Llegó desde tu tarjeta',
  'Filming consent on file · {date}': 'Consentimiento de grabación registrado · {date}',
  'No filming consent yet — the chair will ask first':
    'Sin consentimiento de grabación todavía: la silla lo pedirá primero',
  'Call': 'Llamar',
  'Text': 'Mensaje',
  'Book their next visit ↗': 'Reservar su próxima visita ↗',
  'Book next visit ↗': 'Reservar próxima visita ↗',
  'Preferences': 'Preferencias',
  'Prefers scissors over clippers. Sensitive around the ears.':
    'Prefiere tijera a máquina. Sensible alrededor de las orejas.',
  'Save preferences': 'Guardar preferencias',
  'Visits': 'Visitas',
  'No visits on record yet — their first chair session will land here.':
    'Aún no hay visitas registradas: su primera sesión en la silla aparecerá aquí.',
  'All takes': 'Todas las tomas',
  'Passed on': 'Descartada',
  'Show all {n} takes': 'Ver las {n} tomas',
  // ── the day's pulse on Today ──
  'Today vs a normal day': 'Hoy frente a un día normal',
  'Normal day': 'Día normal',
  'Clients in the chair by hour, today against a normal day':
    'Clientes en la silla por hora, hoy frente a un día normal',
  'Hour': 'Hora',
  '{n} in the chair so far — a normal day has {m} by now.':
    '{n} en la silla hasta ahora: un día normal lleva {m} a esta hora.',
  '{n} in the chair so far. A few more days in the chair and the normal-day line fills in.':
    '{n} en la silla hasta ahora. Con unos días más de trabajo se completará la línea del día normal.',
  'The chair this week': 'La silla esta semana',
  'Chair visits': 'Visitas a la silla',
  'Clients seen': 'Clientes atendidos',
  'Came back': 'Volvieron',
  'Live takes': 'Tomas en vivo',
  'Most tried in the mirror': 'Los más probados en el espejo',
  'No takes yet this week.': 'Aún no hay tomas esta semana.',
  'Most chosen': 'Los más elegidos',
  'Nothing approved yet this week.': 'Nada aprobado todavía esta semana.',
  'Last 7 days': 'Últimos 7 días',
  'What your card and your chair did this week.': 'Lo que hicieron tu tarjeta y tu silla esta semana.',
  'Set up your barber card first — insights start once it’s live.':
    'Configura primero tu tarjeta de barbero: las estadísticas empiezan cuando esté publicada.',
  'Your card’s numbers, appointments and client requests now live under':
    'Los números de tu tarjeta, las citas y las solicitudes de clientes ahora están en',
  'Already set up? Open your dashboard →': '¿Ya está listo? Abre tu panel →',
  'Trying a cut on yourself? Start here →': '¿Quieres probarte un corte? Empieza aquí →',

  // ── calendar tab + insights charts ──
  'Calendar': 'Calendario',
  'Set up your barber card first — appointments book through it.':
    'Configura primero tu tarjeta de barbero: las citas se reservan a través de ella.',
  'Edit hours': 'Editar horario',
  'Previous week': 'Semana anterior',
  'This week##calendar': 'Esta semana',
  'Next week': 'Semana siguiente',
  'Appointments, week of {range}': 'Citas, semana del {range}',
  'No appointments this week — slots are live on your card.':
    'Sin citas esta semana: los horarios están activos en tu tarjeta.',
  'Example week': 'Semana de ejemplo',
  'Appointment details': 'Detalles de la cita',
  'Phone': 'Teléfono',
  'What they asked for': 'Lo que pidió',
  'The faded blocks are an example of how a booked week looks.':
    'Los bloques atenuados son un ejemplo de cómo se ve una semana con citas.',
  // example-week services
  'Skin fade + line-up': 'Degradado a piel + perfilado',
  'Scissor cut': 'Corte a tijera',
  'Taper + beard': 'Degradado suave + barba',
  'Buzz cut': 'Corte al rape',
  'Mid fade': 'Degradado medio',
  'Kids cut': 'Corte infantil',
  'Fade + design': 'Degradado + diseño',
  'Line-up': 'Perfilado',
  'Textured crop': 'Crop texturizado',
  'Hot towel shave': 'Afeitado con toalla caliente',
  'Trim + wash': 'Recorte + lavado',
  'Takes approved': 'Tomas aprobadas',
  'Chair activity, last 14 days': 'Actividad de la silla, últimos 14 días',
  'Last 14 days': 'Últimos 14 días',
  'Date': 'Fecha',
  'Tried vs chosen, last 7 days': 'Probados vs elegidos, últimos 7 días',
  'Tried vs chosen': 'Probados vs elegidos',
  'Tried in the mirror': 'Probados en el espejo',
  'Chosen': 'Elegidos',
  'Cut': 'Corte',

  // ── chair: background save + scrap session ──
  'See your next cut on you, live': 'Mira tu próximo corte en ti, en vivo',
  'Clients get a live mirror here — these are the cuts it will suggest.':
    'Aquí tus clientes tienen un espejo en vivo: estos son los cortes que sugerirá.',
  'Before we film, {name}': 'Antes de grabar, {name}',
  'None of these — save nothing': 'Ninguno — no guardes nada',
  'Save failed': 'Error al guardar',
  'Couldn’t save that take': 'No se pudo guardar esa toma',
  'The clip is still here. Check the connection and try again.':
    'El vídeo sigue aquí. Revisa la conexión e inténtalo de nuevo.',
  'Try saving again': 'Intentar guardar de nuevo',
  'Scrap it — save nothing': 'Descártalo — no guardes nada',
  'Saving under {name}…': 'Guardando en {name}…',
  'The reference angles are filing themselves in the background — no need to wait.':
    'Los ángulos de referencia se archivan solos en segundo plano: no hace falta esperar.',
  'Takes are running but none got kept — when a look lands, “that’s the one” files the reference for next visit.':
    'Hay tomas en marcha pero ninguna guardada: cuando un look convenza, «ese es» archiva la referencia para la próxima visita.',

  // ── the 60-second take + the review-screen reference sheet ──
  '60 seconds': '60 segundos',
  'We’ll film up to 3 minutes of you in the chair and show your face with the haircut applied, so your barber can see it from every angle.':
    'Grabaremos hasta 3 minutos tuyos en la silla y mostraremos tu cara con el corte aplicado, para que tu barbero lo vea desde todos los ángulos.',
  'The next step will use the camera to style your hair. You have up to 3 minutes to explore which hairstyles fit you best! Use the prompt box and suggestions below to style.':
    'El siguiente paso usará la cámara para peinarte. ¡Tienes hasta 3 minutos para explorar qué cortes te quedan mejor! Usa el cuadro de texto y las sugerencias de abajo para estilizar.',
  'We’ll film up to 3 minutes of you and show your face with the haircut applied, live, so you can see it move.':
    'Grabaremos hasta 3 minutos tuyos y mostraremos tu cara con el corte aplicado, en vivo, para que lo veas moverse.',
  'Reference shots': 'Fotos de referencia',
  'Reading the take for the sharpest angles…':
    'Analizando la toma para encontrar los ángulos más nítidos…',
  'Couldn’t read reference shots out of this take. You can still keep the cut.':
    'No se pudieron extraer fotos de referencia de esta toma. Aun así puedes quedarte con el corte.',
  'No clear frames in that take — try another with steadier light.':
    'No hay fotogramas claros en esa toma: prueba otra con luz más estable.',
  'Tap the 2–4 shots the barber should cut from.':
    'Toca las 2–4 fotos desde las que el barbero debería cortar.',
  'The camera couldn’t verify these angles — check them before you save.':
    'La cámara no pudo verificar estos ángulos: revísalos antes de guardar.',
  'Reading the take…': 'Analizando la toma…',
  '{n} reference shots saved under this client.':
    '{n} fotos de referencia guardadas con este cliente.',
  'Sign in to build your card and run live try-ons in the chair.':
    'Inicia sesión para crear tu tarjeta y hacer pruebas en vivo en la silla.',
};

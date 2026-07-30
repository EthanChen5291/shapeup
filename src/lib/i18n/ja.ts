// Japanese (日本語) translations, keyed by the English source string.
// Keep keys byte-for-byte identical to the English text passed to t().
// Use {name} placeholders for interpolated values.

export const ja: Record<string, string> = {
  // ── Generic / shared ──
  'Save': '保存',
  'Saved': '保存しました',
  'Cancel': 'キャンセル',
  'Edit': '編集',
  'Delete': '削除',
  'Export': 'エクスポート',
  'Sign in': 'ログイン',
  'Sign up': '新規登録',
  'Sign out': 'ログアウト',
  'Log out': 'ログアウト',
  'Continue': '続ける',
  'Back': '戻る',
  'Next': '次へ',
  'Done': '完了',
  'Close': '閉じる',
  'Loading…': '読み込み中…',
  'Something went wrong': '問題が発生しました',
  'Something went wrong. Please try again.': '問題が発生しました。もう一度お試しください。',

  // ── Profile menu / nav ──
  'Settings': '設定',
  'Home': 'ホーム',
  'Dashboard': 'ダッシュボード',
  'Rescan': '再スキャン',
  'Pricing': '料金',
  'Contact': 'お問い合わせ',
  'Account': 'アカウント',
  'Credits': 'クレジット',

  // ── Settings: sign-in gate ──
  'Sign in to manage your account, appearance, render quality, and privacy settings.':
    'ログインすると、アカウント・外観・レンダリング品質・プライバシー設定を管理できます。',

  // ── Settings: Account ──
  'Your public display name': '公開される表示名',
  'your username': 'ユーザー名',

  // (No appearance strings: the app is dark, there is nothing to choose.)

  // ── Settings: Render Quality ──
  'Render Quality': 'レンダリング品質',
  'How sharply hairstyles render': 'ヘアスタイルの描画の細かさ',
  'Performance': 'パフォーマンス',
  'Lighter render, faster on any device': '軽量な描画。どの端末でも快適に動作します',
  'Balanced': 'バランス',
  'Default — looks great on most screens': '標準 — ほとんどの画面できれいに見えます',
  'High': '高品質',
  '3× pass render for maximum hair definition': '3パス描画で髪のディテールを最大限に再現',

  // ── Settings: Language ──
  'Language': '言語',
  'App display language': 'アプリの表示言語',
  'English': '英語',
  'Español': 'スペイン語',

  // ── Settings: 3D Scan ──
  '3D Scan': '3Dスキャン',
  'Rebuild your 3D head model from a new photo.': '新しい写真から3Dヘッドモデルを作り直します。',

  // ── Settings: Privacy & Data ──
  'Privacy & Data': 'プライバシーとデータ',
  'Improve ShapeUp': 'ShapeUpの改善に協力',
  'We use your information to enhance our user experience.':
    'お客様の情報は、ユーザー体験の向上のために利用します。',
  'Biometric consent': '生体情報の同意',
  'not granted': '未同意',
  "What's that?": 'これは何ですか？',
  'Revoke consent': '同意を取り消す',
  'Consent revoked. Your facial scans have been deleted.':
    '同意を取り消しました。顔のスキャンデータは削除されました。',
  "This is your go-ahead for us to turn your selfie into a personal 3D head model — the magic that lets you try on cuts and see how they actually sit on you. Your scan stays yours: kept private and just for your models. You can revoke this anytime and we'll delete it. One heads-up — once you revoke, state law means we can't build any new models for you.":
    'これは、あなたの自撮り写真から専用の3Dヘッドモデルを作成することへの同意です。このモデルがあるから、実際に似合うかどうかを確かめながらカットを試せます。スキャンデータはあなたのものです。非公開のまま、あなたのモデルにのみ使用します。いつでも同意を取り消すことができ、その場合はデータを削除します。ひとつご注意ください。取り消し後は、州法により新しいモデルを作成できなくなります。',
  'Download my data': 'データをダウンロード',
  'Export your account info as JSON (GDPR / CCPA).':
    'アカウント情報をJSONで書き出します（GDPR / CCPA対応）。',
  'Delete account': 'アカウントを削除',
  'Permanently removes your data. This cannot be undone.':
    'データを完全に削除します。この操作は取り消せません。',
  'Confirm delete': '削除を確定',
  'All scans, projects, and your account will be deleted.':
    'すべてのスキャン・プロジェクト・アカウントが削除されます。',
  'policy': 'ポリシー',
  'Spanish': 'スペイン語',
  'Japanese': '日本語',

  // ── Tokens / profile menu ──
  'Tokens': 'トークン',
  '{plan} plan': '{plan}プラン',
  'Includes {n} free/month · resets monthly, unused don\'t roll over': '毎月{n}回分が無料 · 毎月リセット、繰り越しはありません',
  'Get more tokens': 'トークンを追加',
  'Refer a friend for': '友だちを招待して',
  '6 tokens': '6トークン',
  'REDEEM A CODE': 'コードを利用する',
  'Redeem': '利用する',
  'Show my barber a 360°': 'バーバーに360°で見せる',

  // ── Dashboard popups ──
  'Scan now!': '今すぐスキャン！',
  'Drop in the chair and start styling yourself in 3D!':
    '椅子に座る前に、3Dでスタイリングを始めましょう！',
  'Take Picture': '写真を撮る',
  "You've hit the limit of {max} cuts. Delete one to make room for a fresh style.":
    'カットの上限{max}件に達しました。ひとつ削除して、新しいスタイルの空きを作りましょう。',
  'Got it': 'わかりました',

  // ── Referral popup ──
  'Refer a friend': '友だちを招待',
  'Get': 'ふたりで',
  'together': 'もらえる',
  'Share your invite link. When a friend signs up and completes their first scan, you both get 3 tokens — 6 in total. There’s no limit, so invite as many friends as you like.':
    '招待リンクをシェアしましょう。友だちが登録して最初のスキャンを完了すると、ふたりに3トークンずつ、合計6トークンが贈られます。回数に上限はないので、好きなだけ招待できます。',
  'Your invite link': 'あなたの招待リンク',
  'Generating your link…': 'リンクを作成中…',
  'Copied': 'コピーしました',
  'Copy': 'コピー',

  // ── Reuse scan popup ──
  'New project': '新しいプロジェクト',
  'Start from your saved scan, or take a fresh selfie.':
    '保存済みのスキャンから始めるか、新しく自撮りしましょう。',
  'Setting up…': '準備中…',
  'Use my selfie': '自撮り写真を使う',
  'Take a new selfie': '新しく自撮りする',
  'Reusing your scan is free — no token spent.':
    'スキャンの再利用は無料です。トークンは消費しません。',

  // ── Delete confirm ──
  'Delete this cut?': 'このカットを削除しますか？',
  'Are you sure you want to delete': '本当に削除しますか：',
  'No, keep it': 'いいえ、残す',
  'Yes, delete': 'はい、削除する',

  // ── Titles / nav ──
  'My': 'マイ',
  'Cuts': 'カット',
  'Saved##title': 'お気に入り',
  'home': 'ホーム',
  'saved': 'お気に入り',
  'explore': 'さがす',
  'settings': '設定',
  'all': 'すべて',
  'recent': '最近',
  'find a style...': 'スタイルを検索...',
  'Scan now': '今すぐスキャン',
  'new cut': '新しいカット',
  'Browse my cuts': 'マイカットを見る',
  'your keepers go here': 'お気に入りはここに並びます',
  'Nothing pinned yet. Tap the bookmark on any cut and it lands on this wall.':
    'まだ何もありません。カットのブックマークをタップすると、ここに並びます。',
  'sign in to see your keepers': 'ログインしてお気に入りを見る',
  'Your saved cuts live here. Sign in to bookmark styles and build your collection.':
    '保存したカットはここに集まります。ログインしてスタイルをブックマークし、自分のコレクションを作りましょう。',
  'Pick a cut to show your barber a 360°': 'バーバーに360°で見せるカットを選びましょう',
  'Style it': 'スタイリングする',
  'you': 'あなた',

  // ── Scan result / ScanResultPopup ──
  'Your scan': 'あなたのスキャン',

  // ── Scan popup ──
  'Analyzing your look...': 'あなたの顔を解析中...',
  'Please allow up to 2 minutes while we build your 3D model':
    '3Dモデルの作成に最大2分ほどかかります',
  'Unknown error': '不明なエラー',
  'Try again': 'もう一度試す',
  'Retake photo': '写真を撮り直す',
  "Let's meet you": 'はじめまして',
  'Take a selfie!': '自撮りしましょう！',
  'Close scan dialog': 'スキャン画面を閉じる',
  'Set up!': '設定しましょう！',
  'Choose a username': 'ユーザー名を決める',
  'Letters, numbers, and underscores only.': '英数字とアンダースコアのみ使えます。',
  'e.g. freshcuts_mike': '例：freshcuts_mike',
  'Saving…': '保存中…',
  'Retake': '撮り直す',
  'Proceed': '進む',
  'Make this your main selfie?': 'これをメインの自撮り写真にしますか？',
  'Your main selfie is the one new projects start from. You can keep your current one if you prefer.':
    'メインの自撮り写真は、新しいプロジェクトの出発点になります。今のままにしておくこともできます。',
  'No': 'いいえ',
  'Yes': 'はい',
  'the looking glass': '鏡の中へ',

  // ── Build phrases (processing) ──
  'Building model': 'モデルを構築中',
  'Drawing blueprint': '設計図を作成中',
  'Mapping your features': '顔の特徴を測定中',
  'Sculpting in 3D': '3Dで造形中',
  'Tracing every angle': 'あらゆる角度をトレース中',
  'Shaping the geometry': '形状を整えています',
  'Adding depth': '奥行きを追加中',
  'Refining the mesh': 'メッシュを調整中',
  'Smoothing the surface': '表面をなめらかに',
  'Polishing details': 'ディテールを仕上げ中',
  'Aligning the lighting': 'ライティングを調整中',
  'Almost there': 'もうすぐです',

  // ── Live checklist ──
  'The barber’s checklist': 'バーバーのチェックリスト',
  'One face in frame': '写っているのは1人だけ',
  'Arm’s length away': '腕をのばした距離',
  'Facing forward': '正面を向く',
  'Good, even light': '明るくムラのない光',
  'Holding still': '動かずに静止',
  'Sit against a plain, solid-color wall with no bright window or lamp behind your head — it keeps your hair sharp for the 3D model!':
    '無地の壁を背に、頭の後ろに明るい窓や照明が入らないようにしましょう。髪がくっきり写り、3Dモデルの精度が上がります！',

  // ── Pricing page ──
  'back': '戻る',
  'pricing': '料金',
  'See yourself in the cut before you sit in the chair.':
    '椅子に座る前に、その髪型の自分を見てみましょう。',
  'avg barber visit': '理美容室の平均単価',
  '1 AI look': 'AIスタイル1回',
  'popular': '人気',
  'one-time purchase · no subscription · secured by stripe':
    '買い切り · サブスクなし · Stripeによる安全な決済',
  // Checkout failures (lib/checkout.ts + the Stripe route, shown via t()).
  'Couldn’t open checkout. Check your connection and try again.':
    'チェックアウトを開けませんでした。接続を確認してもう一度お試しください。',
  'Your session expired — sign in again, then retry.':
    'セッションの有効期限が切れました。もう一度サインインしてからお試しください。',
  'Couldn’t start checkout — the payment service didn’t respond. Try again in a moment.':
    'チェックアウトを開始できませんでした。決済サービスが応答しません。しばらくしてからもう一度お試しください。',
  'Dismiss': '閉じる',
  'Free': '無料',
  'Starter': 'スターター',
  'Popular': '人気',
  'Pro': 'プロ',
  'forever': 'ずっと',
  'one-time': '買い切り',
  'Prebaked styles': '既製スタイル',
  '8 AI looks': 'AIスタイル8回',
  '50 AI looks': 'AIスタイル50回',
  '200 AI looks': 'AIスタイル200回',
  'Start free': '無料で始める',
  'Try 8 looks': '8スタイル試す',
  'Get 50 looks': '50スタイル手に入れる',
  'Get 200 looks': '200スタイル手に入れる',
  'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.':
    'プロが厳選した30以上のスタイルを、あなたの3Dスキャンに反映して閲覧できます。生成不要、ずっと無料。',
  '8 custom renders for less than a buck. Test a fade, a crop, and a taper before your next appointment.':
    '1ドル未満で8回のカスタム生成。次の予約の前に、フェード・クロップ・テーパーを試せます。',
  '50 looks to explore. Find what works for your face shape, then walk in with a reference photo.':
    '50スタイルをじっくり試せます。顔の形に合う髪型を見つけて、参考写真を持って行きましょう。',
  'Serious about your hair. 200 looks at 7.5¢ each — experiment until you find a signature style.':
    '髪に本気なあなたへ。1回7.5セントで200スタイル。自分の定番が見つかるまで試せます。',

  // ── Free-for-limited-time mode ──
  'Status': 'ステータス',
  'Limited time': '期間限定',
  'limited time': '期間限定',
  'Every look is on the house for a limited time — try a fade, a crop, and a taper, all free.':
    '期間限定で、どのスタイルも無料。フェードもクロップもテーパーも、すべて試せます。',
  'Everything’s free right now — make as many looks as you like, on the house.':
    '今はすべて無料です。好きなだけスタイルを作ってください。',
  'ShapeUp is completely free!': 'ShapeUpは完全無料です！',
  'We believe everyone should be able to explore their hairstyles at no cost. Because it costs us some money to run, we may add options to donate, but no payment. Try on as many hairstyles as you want and tell us what you think!':
    '誰もが費用をかけずに自分の髪型を試せるべきだと考えています。運営には費用がかかるため、寄付の仕組みを設けることはあるかもしれませんが、料金はいただきません。好きなだけ試して、感想を聞かせてください！',

  // ── Phone-bonus ribbon + modal ──
  'Free generations offer': '無料生成キャンペーン',
  'Add your phone number and get': '電話番号を登録すると',
  '{n} free generations': '{n}回の無料生成',
  'one tap, fully secure': 'ワンタップ、安全に完了',
  'Claim +{n}': '+{n}を受け取る',
  'Dismiss offer': 'このお知らせを閉じる',
  '+{n} generations added!': '+{n}回の生成を追加しました！',
  'Get {n} free generations': '{n}回の無料生成を受け取る',
  'Verify your phone number and we’ll drop {n} generations into your account. We only use it to keep the bonus fair — no spam, ever.':
    '電話番号を認証すると、アカウントに{n}回分の生成を追加します。特典を公平に保つためだけに利用し、迷惑メッセージは一切送りません。',
  'Enter the 6-digit code we just texted you.': 'SMSで送信した6桁のコードを入力してください。',
  'Phone number': '電話番号',
  'Include your country code, e.g. +1.': '国番号を含めてください（例：+81）。',
  'Verification code': '認証コード',
  'They’re in your balance now. Go try a new look!': '残高に追加されました。新しいスタイルを試してみましょう！',
  'Text me a code': 'コードをSMSで送る',
  'Sending…': '送信中…',
  'Verify & claim +{n}': '認証して+{n}を受け取る',
  'Use a different number': '別の番号を使う',
  'Enter a valid phone number, including country code.': '国番号を含む有効な電話番号を入力してください。',
  "Couldn't send the code. Check the number and try again.": 'コードを送信できませんでした。番号を確認して、もう一度お試しください。',
  'Enter the code we texted you.': 'SMSで送信したコードを入力してください。',
  'That code was incorrect or expired. Try again.': 'コードが正しくないか、有効期限が切れています。もう一度お試しください。',
  "Couldn't grant your bonus. Please try again.": '特典を付与できませんでした。もう一度お試しください。',
  "Couldn't reach the server. Please try again.": 'サーバーに接続できませんでした。もう一度お試しください。',

  // ── Landing page ──
  'dashboard': 'ダッシュボード',
  'Completely Free For Everyone · 3D Preview in 60 Seconds':
    '誰でも完全無料 · 60秒で3Dプレビュー',
  'see it first.': 'まず、見る。',
  'love': 'もっと好きになる。',
  'it more.': '',
  'Take one selfie. See 10+ haircuts on your actual 3D face.':
    '自撮り1枚。10種類以上の髪型を、あなた自身の3Dの顔で確かめられます。',
  'Walk into the barber knowing exactly what you want.':
    'ほしい髪型がはっきり決まった状態で、椅子に座れます。',
  'sound familiar?': '心当たり、ありませんか？',
  'You describe it.': 'あなたは言葉で伝える。',
  'They hear something different.': '相手には別の髪型が伝わる。',
  'You walk out of the barber disappointed — not because your barber was bad, but because there was no way to show exactly what you meant.':
    'がっかりして店を出る。理美容師の腕が悪いのではなく、思い描いた髪型を正確に見せる方法がなかっただけです。',
  '~6 weeks': '約6週間',
  'to grow back a bad cut': '失敗したカットが伸びるまで',
  'A bad cut takes time to go away. Hair grows about half an inch a month.':
    '失敗したカットは、すぐには元に戻りません。髪が伸びるのは1か月に約1.3センチです。',
  '$45+ a visit': '1回45ドル以上',
  'no preview, full commitment': '確認なし、後戻りなし',
  'You bind yourself to paying before you see anything, with no refunds :(':
    '仕上がりを見る前に支払いが確定し、返金もありません :(',
  '1 in 3': '3人に1人',
  "leave wishing they'd said more": 'もっと言えばよかったと思いながら店を出る',
  "The cut isn't what you wanted. Yet you stay quiet in the chair.":
    '希望どおりの仕上がりではない。それでも椅子の上では黙ってしまう。',
  'We show you how any hairstyle looks on your face. Then, we give your barber the steps to make it happen.':
    'どんな髪型もあなたの顔で確かめられます。そして、それを実現する手順を理美容師に渡します。',
  '60 secs': '60秒',
  'SCAN TO 3D PREVIEW': 'スキャンから3Dプレビューまで',
  'Just one minute from selfie to full 3D model.':
    '自撮りから完全な3Dモデルまで、たった1分。',
  '1 selfie': '自撮り1枚',
  'ALL YOU NEED': '必要なのはこれだけ',
  'One photo is all it takes. Help us secure the best cut for you.':
    '写真1枚あれば十分です。あなたに最高のカットを届けさせてください。',
  'FOR EVERY HAIRSTYLE': 'どんな髪型でも',
  'See yourself in as many cuts as you want — on the house, for a limited time.':
    '好きなだけカットを試せます。期間限定で無料です。',
  'how it': '仕組みは',
  'works': 'シンプル',
  'This demo is live — send a message and try it yourself.':
    'このデモは実際に動きます。メッセージを送って試してみてください。',
  'Selfie': '自撮り',
  '30 seconds': '30秒',
  'just one selfie': '自撮り1枚だけ',
  'Describe': '伝える',
  'text it like a friend': '友だちに送る感覚で',
  'tap send — step 3 updates live': '送信をタップ — ステップ3がその場で更新',
  'Show your barber': 'バーバーに見せる',
  'your 3D preview, live': 'あなたの3Dプレビューを、その場で',
  'Ready to see your next cut?': '次のカット、見てみませんか？',
  'Explore My Best Hairstyles': '似合う髪型をさがす',
  'takes about 60 seconds · no account required':
    '所要時間は約60秒 · アカウント登録は不要',
  'Get a glimpse of all': 'なりたい',
  'could be.': 'のすべてを、ひと目で。',
  'clean & sharp': '清潔感とシャープさ',
  'textured top': 'トップに動きを',
  'volume & flow': 'ボリュームと流れ',
  'low maintenance': '手入れがらく',
  'effortless cool': '力の抜けたかっこよさ',
  'versatile classic': '万能なクラシック',
  '1 haircut generation': 'カット生成1回',
  '8 haircut generations': 'カット生成8回',
  '50 haircut generations': 'カット生成50回',
  '200 haircut generations': 'カット生成200回',
  'Explorer': 'エクスプローラー',
  'Pick your style.': 'スタイルを選ぶ。',
  'Try It For Yourself': '自分で試してみる',
  'takes about 60 seconds': '所要時間は約60秒',
  'Your photo stays private': '写真は非公開のまま',
  'We never sell or share your scan. Delete your data anytime from settings.':
    'スキャンデータを販売・共有することはありません。設定からいつでも削除できます。',
  'AI trained on real cuts': '実際のカットで学習したAI',
  '3D facial mesh and strand-level simulation built from real barbershop styles.':
    '実際のバーバースタイルをもとに、3Dの顔メッシュと毛束レベルのシミュレーションを構築しています。',
  'Free to try, no risk': '無料で試せる、リスクなし',
  'Your first previews are completely free. Pay only if you love the results.':
    '最初のプレビューは完全無料。気に入ったときだけ支払えば大丈夫です。',
  'Privacy': 'プライバシー',
  'Terms': '利用規約',
  'Biometric notice': '生体情報に関する通知',
  'Delete my data': 'データを削除',
  'create your account': 'アカウントを作成',
  'sign in to purchase': 'ログインして購入',
  'Start exploring.': 'さっそく始めましょう。',
  'One step away.': 'あと一歩です。',

  // ── SignUpWidget (auth) ──
  'Go to dashboard': 'ダッシュボードへ',
  'Check your inbox': 'メールを確認してください',
  'We sent a 6-digit code to {email}': '{email} に6桁のコードを送信しました',
  'Verify': '認証する',
  'Verifying…': '認証中…',
  'Two-factor authentication': '二段階認証',
  'Enter the code sent to your phone': '携帯電話に届いたコードを入力してください',
  'Enter the code sent to {email}': '{email} に届いたコードを入力してください',
  'One sec…': '少々お待ちください…',
  'Continue with email': 'メールで続ける',
  'or': 'または',
  'Continue with Google': 'Googleで続ける',
  'password': 'パスワード',
  'Free to start · No credit card · By continuing, you agree to the':
    '無料で開始 · クレジットカード不要 · 続けることで、以下に同意したものとみなされます：',
  'and': 'および',
  'Privacy Policy': 'プライバシーポリシー',
  // auth error messages (translated at render via t(error))
  'Sign-in is not configured for this deployment.':
    'この環境ではログインが設定されていません。',
  'Sign-in is still loading. Try again in a moment.':
    'ログインを準備中です。少し待ってからもう一度お試しください。',
  'Wrong password — try again.': 'パスワードが違います。もう一度お試しください。',
  'This password was found in a data breach. Please choose a different one.':
    'このパスワードは情報漏えいで確認されています。別のものを設定してください。',
  'This account was created with Google. Use "Continue with Google" to sign in.':
    'このアカウントはGoogleで作成されています。「Googleで続ける」からログインしてください。',
  'Your account has been suspended. Contact support for help.':
    'アカウントが停止されています。サポートまでお問い合わせください。',
  'Too many attempts — please wait a moment and try again.':
    '試行回数が多すぎます。少し待ってからもう一度お試しください。',
  "You're already signed in.": 'すでにログインしています。',
  'Please enter both your email and password.':
    'メールアドレスとパスワードの両方を入力してください。',
  'No account found with that email.':
    'そのメールアドレスのアカウントは見つかりませんでした。',
  'Sign-in incomplete — please try again.':
    'ログインが完了しませんでした。もう一度お試しください。',
  'Sign-up failed — please try again.':
    '登録に失敗しました。もう一度お試しください。',
  'Password is too weak — use at least 8 characters with a mix of letters and numbers.':
    'パスワードが弱すぎます。英字と数字を混ぜて8文字以上にしてください。',
  'An account with this email already exists. Try signing in instead.':
    'このメールアドレスのアカウントはすでに存在します。ログインをお試しください。',
  'Invalid code — try again': 'コードが正しくありません。もう一度お試しください',
  'Verification failed — please try again.':
    '認証に失敗しました。もう一度お試しください。',
  'Google sign-in failed': 'Googleログインに失敗しました',

  // ── PricingPopup ──
  'out of tokens': 'トークン切れ',
  'top up your cuts': 'カットを補充',
  'Get more to keep the fresh cuts coming.':
    '追加して、新しいカットを試し続けましょう。',

  // ── Studio ──
  'Error — check console': 'エラー — コンソールを確認してください',
  'Building your 3D model…': '3Dモデルを構築中…',
  'We infer shape, hairline & proportions from your photos — a great likeness, not a measurement.':
    '写真から輪郭・生え際・比率を推定しています。実測ではなく、よく似た再現です。',
  'The barber’s': 'バーバーの',
  'Toolbox': 'ツールボックス',
  'new request': '新しいリクエスト',
  'Render in 3D': '3Dでレンダリング',
  'Voice': '音声',
  'Enter your desired hairstyle in the toolbox!':
    'ツールボックスに希望の髪型を入力してください！',
  'Hair Parameters': '髪のパラメーター',
  'Hair length': '髪の長さ',
  'Width': '幅',
  'Ponytail-ness': 'ポニーテール感',
  'Density': '密度',
  'Wavyness': 'ウェーブ感',
  'Parting': '分け目',
  'live measurements': 'リアルタイム測定',
  'auto': '自動',
  'take it to your barber': 'バーバーに持っていく',
  'Barber’s order': 'バーバーへのオーダー',
  'preset': 'プリセット',
  'type': '入力',
  'Project not found': 'プロジェクトが見つかりません',
  'the toolbox': 'ツールボックス',
  'THE': 'ザ・',
  'studio': 'スタジオ',
  'live · 3d sculpt': 'ライブ · 3D造形',
  'Rendering your barber video': 'バーバー用の動画を書き出し中',
  'Hide photo': '写真を隠す',
  'Show photo': '写真を表示',

  // ── EditPanel (toolbox) ──
  'Apply': '適用',
  'Apply hair edit request': '髪型の編集リクエストを適用',
  'Hair editor controls': '髪型エディターの操作',
  'Styling…': 'スタイリング中…',
  'Rendering…': 'レンダリング中…',
  'FRESH CUT': 'フレッシュカット',
  'shapeup approved': 'shapeup認定',
  'oops': 'おっと',
  'More trending cuts': '人気のカットをもっと見る',
  'Sketching the cut progress': 'カットの下書きの進捗',
  'Sculpting in 3D progress': '3D造形の進捗',
  // prompt placeholders
  '"Messy taper fade, please."': '「無造作なテーパーフェードでお願いします。」',
  '"Take the sides down to a #2."': '「サイドは2ミリまで下げてください。」',
  '"Keep the length, just add texture."': '「長さはそのままで、動きだけ足してください。」',
  '"Mid fade, clean line-up."': '「ミッドフェードで、ラインは細く整えて。」',
  '"Curly on top, skin fade sides."': '「トップはカール、サイドはスキンフェードで。」',
  // chatter — sketch
  'Sketching the cut…': 'カットを下書き中…',
  'Reading your curl pattern…': '髪のうねりを読み取り中…',
  'Combing through the details…': 'ディテールを整え中…',
  'Eyeballing the blend…': 'つなぎ目を見極め中…',
  // chatter — hairstep
  'Sculpting it in 3D…': '3Dで造形中…',
  'Setting every strand…': '一本ずつ整え中…',
  'Spinning the chair around…': '椅子を回転中…',
  'Holding up the mirror…': '合わせ鏡を用意中…',

  // ── Barber card (public /b/<slug>) ──
  'Try on {cut}': '{cut}を試す',
  'Links': 'リンク',
  'This barber hasn’t added recommendations yet.':
    'このバーバーはまだおすすめを登録していません。',
  'Explore the best hairstyles for you': 'あなたに似合う髪型をさがす',
  'All': 'すべて',
  'Tap any cut to see it on your own head.':
    'カットをタップすると、自分の頭で確認できます。',
  'Virtual try-on': 'バーチャル試着',
  'Fitting room by ShapeUp': 'ShapeUpのフィッティングルーム',
  'Photo of {name}': '{name}の写真',
  'Services': 'メニュー',
  'Filter styles': 'スタイルを絞り込む',
  'Barber’s pick': 'バーバーのおすすめ',
  'Barber’s picks': 'バーバーのおすすめ',
  'Men’s': 'メンズ',
  'Women’s': 'レディース',
  'What are we doing today?': '今日はどうしますか？',
  'Keep it familiar, or discover the cuts that suit you best.':
    'いつもどおりでも、似合うカットを新しく見つけても大丈夫です。',
  'Just doing a trim.': '軽く整えるだけ。',
  'Show me my best hairstyles': '似合う髪型を見せて',
  'From the menu': 'メニューから',
  'Tap a cut to try it on': 'カットをタップして試す',
  'Sure. What kind of trim?': 'わかりました。どんなふうに整えますか？',
  'Leave a note for your barber': 'バーバーへのメモを残す',
  'Clean up the sides, keep the length…': 'サイドはすっきり、長さはそのまま…',
  'Show it to them from the chair — nothing to send.':
    '椅子に座ったまま見せるだけ。送信は不要です。',
  'While you wait — see your best hairstyles':
    '待っている間に — 似合う髪型を見てみる',
  'Finding the cuts that fit you.': 'あなたに合うカットをさがしています。',
  'Preparing the selfie camera': '自撮りカメラを準備中',

  // ── Barber try-on (embedded selfie -> generate -> send flow) ──
  'Try it on yourself': '自分で試してみる',
  'All styles': 'すべてのスタイル',
  'Take a selfie': '自撮りする',
  'Your photo': 'あなたの写真',
  '{n} ahead of you': 'あと{n}人待ち',
  'Let’s see how it looks on you!': '似合うか見てみましょう！',
  'Preparing your preview': 'プレビューを準備中',
  'Applying the hairstyle': '髪型を適用中',
  'Building your 3D look': '3Dの仕上がりを構築中',
  'Checking your photo…': '写真を確認中…',
  'Photo looks good': '写真は問題ありません',
  'Keep your full head in frame': '頭全体を画面に収めてください',
  'Use this photo': 'この写真を使う',
  'Camera unavailable — upload a photo instead.':
    'カメラを利用できません。写真をアップロードしてください。',
  'Take the photo': '写真を撮る',
  'Upload a photo': '写真をアップロード',
  'View controls': '表示の操作',
  'Before': 'ビフォー',
  'Reset view': '表示をリセット',
  'Retake selfie': '自撮りを撮り直す',
  'Your original photo': '元の写真',
  'Drag to rotate · scroll to zoom': 'ドラッグで回転 · スクロールで拡大縮小',
  'Book with {name}': '{name}を予約する',
  'One quick sign-in — it’s how we send you the result and let this barber know what you want.':
    '簡単なログインをお願いします。結果をお届けし、希望をバーバーに伝えるために必要です。',
  'Uploading…': 'アップロード中…',
  'Take or choose a photo': '写真を撮るか選ぶ',
  'Editing your photo…': '写真を編集中…',
  'Building your 3D cut…': '3Dのカットを構築中…',
  'In line for the 3D render — {n} ahead of you…': '3Dレンダリングの順番待ち — あと{n}人…',
  'Drag to rotate': 'ドラッグで回転',
  'The 3D render didn’t come through, but here’s your photo.':
    '3Dレンダリングは失敗しましたが、写真はこちらです。',
  'You, wearing {cut}': '{cut}のあなた',
  'Shorter on the sides, keep the top…': 'サイドは短く、トップはそのまま…',
  'Describe a change': '変えたいところを書く',
  'Go': '送信',
  'Send this to my barber': 'これをバーバーに送る',
  'Sent! They’ll see exactly what you want before you sit down.':
    '送信しました！座る前に、希望がそのまま伝わります。',
  'Sent to {name}’s ShapeUp inbox — they’ll see it before your cut.':
    '{name}のShapeUp受信箱に送信しました。カットの前に確認してもらえます。',
  'Couldn’t send that — screenshot this and show them in the chair instead.':
    '送信できませんでした。スクリーンショットを撮って、椅子で見せてください。',
  'Phone (optional)': '電話番号（任意）',
  'That edit didn’t work — try a different photo or cut.':
    'その編集はうまくいきませんでした。別の写真かカットでお試しください。',
  'Something went wrong. Check your connection and try again.':
    '問題が発生しました。通信環境を確認して、もう一度お試しください。',
  'Couldn’t upload that photo — try again.': '写真をアップロードできませんでした。もう一度お試しください。',

  // ── Barber booking (/b/<slug> scheduler) ──
  'Book a time': '時間を予約',
  'Book a chair': '席を予約する',
  '{city} time': '{city}時間',
  'No open times in the next two weeks — reach out directly.':
    '今後2週間に空きがありません。直接ご連絡ください。',
  'Pick a day': '日付を選ぶ',
  'Pick a time': '時間を選ぶ',
  'One quick sign-in so {name} knows the booking is real.':
    '簡単なログインをお願いします。{name}に予約が本物だと伝わります。',
  'Service (optional)': 'メニュー（任意）',
  'Just a cut': 'カットのみ',
  'Booking…': '予約中…',
  'Book {time}': '{time}で予約',
  'You’re booked.': '予約が完了しました。',
  'Add to Google Calendar': 'Googleカレンダーに追加',
  'Apple / Outlook (.ics)': 'Apple / Outlook（.ics）',
  '{name} got the details — just show up.': '{name}に詳細が届きました。当日お越しください。',
  'Haircut with {name}': '{name}でのカット',
  'Cut I tried on: {cut}': '試したカット：{cut}',

  // ── Barber builder: appointments ──
  'Appointments': '予約',
  'Let clients book times on my card': 'カードから予約を受け付ける',
  'Clients pick a real open slot; you both get a confirmation with a calendar invite. No other app needed.':
    'お客様は実際に空いている枠を選べます。双方にカレンダー招待つきの確認が届きます。他のアプリは不要です。',
  'Timezone': 'タイムゾーン',
  'Slot length': '1枠の長さ',
  '{n} minutes': '{n}分',
  'Sunday': '日曜日',
  'Monday': '月曜日',
  'Tuesday': '火曜日',
  'Wednesday': '水曜日',
  'Thursday': '木曜日',
  'Friday': '金曜日',
  'Saturday': '土曜日',
  'Opens': '開店',
  'Closes': '閉店',
  'Closed': '休業',
  "That timezone isn't recognized.": 'そのタイムゾーンは認識できません。',
  'Pick a slot length from the list.': 'リストから1枠の長さを選んでください。',
  'At most one window per day of the week.': '曜日ごとの営業時間は1つまでです。',
  'Days must be Sunday through Saturday.': '曜日は日曜日から土曜日で指定してください。',
  'Hours must look like 09:00.': '時刻は 09:00 の形式で入力してください。',
  'Each day must open before it closes.': '開店時刻は閉店時刻より前にしてください。',
  'Add at least one open day to take bookings.':
    '予約を受け付けるには、営業日を1日以上追加してください。',
  'Upcoming appointments': '今後の予約',
  'Nothing on the books yet — slots are live on your card.':
    'まだ予約はありません。枠はカード上で公開されています。',
  'Cancel {name}’s appointment? They’ll be emailed that the time is off.':
    '{name}の予約をキャンセルしますか？枠が取り消された旨がメールで通知されます。',
  'Cancelling…': 'キャンセル中…',
  'Client requests': 'お客様からのリクエスト',
  'Cuts clients sent from your card — what they want before they sit down.':
    'お客様がカードから送ったカットです。座る前に希望がわかります。',
  'Client preview: {cut}': 'お客様のプレビュー：{cut}',
  'View 360°': '360°で見る',
  '{n}m ago': '{n}分前',
  '{n}h ago': '{n}時間前',
  '{n}d ago': '{n}日前',

  // ── Barber dashboard settings (the header gear) ──
  'Also what the chair shows your client': 'チェアでお客様に表示される言語も同じです',
  'Clock': '時刻表示',
  'How appointment times read': '予約時間の表示形式',
  '12h': '12時間',
  '24h': '24時間',
  'Card is live': 'カードを公開中',
  'Clients can open /b/{slug}': 'お客様は /b/{slug} を開けます',
  'No card yet': 'カードがまだありません',
  'Taking appointments': '予約を受付中',
  'Booking on your card': 'カードで予約を受け付けています',
  'Set working hours on your card first': 'まずカードで営業時間を設定してください',
  'Set your working hours on your card first.': 'まずカードで営業時間を設定してください。',
  'Improve the model': 'モデルの改善に協力',
  'Chair takes help train future cuts': 'チェアのテイクが今後のカットの学習に役立ちます',
  'Edit card': 'カードを編集',

  // ── Barber builder (/barber) ──
  'Build your barber card': 'バーバーカードを作る',
  'Sign in to claim your link and print your mirror QR.':
    'ログインしてリンクを取得し、鏡に貼るQRコードを印刷しましょう。',
  'Your barber card': 'あなたのバーバーカード',
  'Profile photo': 'プロフィール写真',
  'Profile': 'プロフィール',
  'Upload': 'アップロード',
  'Add a profile photo': 'プロフィール写真を追加',
  'Replace your profile photo': 'プロフィール写真を差し替える',
  'Replace': '差し替える',
  'Clients trust a face. Square crop, up to 8 MB.':
    '顔が見えると安心されます。正方形、8MBまで。',
  'That file isn’t an image — try a JPG or PNG.':
    'そのファイルは画像ではありません。JPGかPNGをお試しください。',
  'That photo is too large — keep it under 8 MB.':
    '写真のサイズが大きすぎます。8MB未満にしてください。',
  'Remove your profile photo?': 'プロフィール写真を削除しますか？',
  'Business details': '店舗情報',
  'Location': '場所',
  'Telegraph Ave, Oakland': '例：渋谷区神宮前',
  'shown under your name': '名前の下に表示されます',
  'Hours': '営業時間',
  'Tue–Sat · 9–6': '火〜土 · 9:00〜18:00',
  'Services & pricing': 'メニューと料金',
  'Add a service': 'メニューを追加',
  'Service name': 'メニュー名',
  'Skin fade': 'スキンフェード',
  'Price': '料金',
  'Remove this service?': 'このメニューを削除しますか？',
  'Booking & links': '予約とリンク',
  'Move up': '上へ移動',
  'Move down': '下へ移動',
  'Remove this link from your card?': 'このリンクをカードから削除しますか？',
  'Notifications': '通知',
  'Recommended cuts': 'おすすめのカット',
  'These lead your card as “Barber’s picks” — clients tap them to try them on.':
    'カードの先頭に「バーバーのおすすめ」として表示されます。お客様はタップして試着できます。',
  'Unsaved changes': '未保存の変更',
  'Insights': 'インサイト',
  'This week': '今週',
  'vs last week': '先週比',
  'Booking taps': '予約タップ数',
  'Previews finished': '完了したプレビュー',
  'Most-tried styles': 'よく試されたスタイル',
  'Clients often leave before finishing a preview — remind them it takes under a minute.':
    'プレビューを終える前に離脱するお客様が多いようです。1分もかからないと伝えてみましょう。',
  'Scans are up from last week ({a} → {b}).':
    'スキャン数が先週より増えています（{a} → {b}）。',
  'Your booking link got {n} taps this week.':
    '今週、予約リンクが{n}回タップされました。',
  '{n} clients joined ShapeUp through your card.':
    '{n}人のお客様が、あなたのカード経由でShapeUpに登録しました。',
  '“{cut}” is your most-tried style.': '「{cut}」が最もよく試されたスタイルです。',
  'A free page for your clients — and a fitting room that shows them the cut on their own head.':
    'お客様のための無料ページ。そして、カットを自分の頭で確かめられるフィッティングルーム。',
  'Your link': 'あなたのリンク',
  'Your name': 'あなたの名前',
  'Name': '名前',
  'Shop': '店舗名',
  'Bio': '自己紹介',
  'Ten years on Telegraph Ave. Walk-ins welcome.':
    '例：この街で10年。予約なしでも大歓迎です。',
  'Notify me at': '通知先',
  'private — never shown on your card': '非公開 — カードには表示されません',
  'When a client picks a cut on your card, we’ll email you the result and their contact info — so you know exactly what to do before they sit down.':
    'お客様がカードでカットを選ぶと、結果と連絡先をメールでお送りします。座る前に、やるべきことがはっきりわかります。',
  'Link type': 'リンクの種類',
  'Remove': '削除',
  'Label (e.g. My portfolio)': 'ラベル（例：ポートフォリオ）',
  'Link label': 'リンクのラベル',
  'Cuts you do': '得意なカット',
  'Clients tap these to try them on. Pick your go-to cuts.':
    'お客様はここをタップして試着します。定番のカットを選びましょう。',
  'Live': '公開中',
  'Save changes': '変更を保存',
  'Publish card': 'カードを公開',
  'Checking…': '確認中…',
  'Available': '利用できます',
  'That name is taken.': 'その名前はすでに使われています。',
  'QR code for your card': 'カードのQRコード',
  'Your card is live': 'カードを公開しました',
  'Copied!': 'コピーしました！',
  'Download mirror card': '鏡用カードをダウンロード',
  'View card ↗': 'カードを見る ↗',
  'Print it and tape it to your mirror. Clients scan it from the chair.':
    '印刷して鏡に貼りましょう。お客様は椅子に座ったまま読み取れます。',
  'Scans': 'スキャン数',
  'Try-ons': '試着数',
  'Link taps': 'リンクタップ数',
  'Clients joined': '登録したお客様',

  // ── For barbers (pitch page) ──
  'Build your card': 'カードを作る',
  'Free for barbers': '理美容師は無料',
  'Your clients stop describing the cut.': 'お客様は、もう髪型を説明しません。',
  'They show you.': '見せてくれます。',
  'A free page for your chair — booking, socials, Venmo, all in one link — with a fitting room built in. A client scans the QR on your mirror, taps a cut, and sees it on their own head. No more “a little off the top.”':
    'あなたの席のための無料ページ。予約もSNSも決済も、ひとつのリンクにまとめて、フィッティングルームまで内蔵。お客様は鏡のQRを読み取り、カットをタップして、自分の頭で確かめます。「上を少しだけ」で終わる会話は、もう必要ありません。',
  'Build your card — free': 'カードを作る — 無料',
  'Claim your link': 'リンクを取得',
  'Pick your name — tryshapeup.cc/b/you. Add booking, Instagram, Venmo, call and text. Free, forever.':
    '名前を決めましょう — tryshapeup.cc/b/あなた。予約、Instagram、決済、電話、メッセージを追加できます。ずっと無料です。',
  'Add the cuts you do': '得意なカットを登録',
  'Choose your go-to styles. Clients tap one and see it on their own head — before you pick up the clippers.':
    '定番のスタイルを選びましょう。お客様はタップするだけで、自分の頭で確認できます。バリカンを手に取る前に。',
  'Tape the QR to your mirror': 'QRを鏡に貼る',
  'Print the card. Every client in your chair scans it, shows you exactly what they want, and lands on your page.':
    'カードを印刷しましょう。席に座ったお客様が読み取り、希望を正確に見せてくれて、あなたのページにたどり着きます。',
  'It’s the free tool your clients actually want.':
    'お客様が本当に求めていた、無料のツールです。',
  'Every client who scans your QR and signs up is tracked back to you. Watch it on your dashboard.':
    'QRを読み取って登録したお客様は、すべてあなたの成果として記録されます。ダッシュボードで確認できます。',
  'Get started': 'はじめる',

  // ── Barber builder: shop banner ──
  'Add a shop banner': '店舗バナーを追加',
  'Edit banner': 'バナーを編集',
  'Replace banner': 'バナーを差し替える',
  'Upload banner': 'バナーをアップロード',
  'Use a JPG or PNG under 8 MB.': '8MB未満のJPGまたはPNGを使用してください。',
  'Couldn’t upload that banner — try again.': 'バナーをアップロードできませんでした。もう一度お試しください。',
  'Remove your banner image?': 'バナー画像を削除しますか？',

  // ── Barber card: extras ──
  'Open {location} in Google Maps': '{location}をGoogleマップで開く',
  'Hairstyle collections': 'ヘアスタイル集',
  'Menu': 'メニュー',
  'This barber hasn’t added picks yet — explore the full menu.':
    'このバーバーはまだおすすめを登録していません。メニュー全体からさがしてみてください。',
  'Sending 360…': '360°を送信中…',
  'Send 360 to {name}': '360°を{name}に送る',

  // ── EditPanel: haircut reference photo ──
  'Hair reference attached': '参考写真を添付しました',
  'Selected haircut reference': '選択したカットの参考写真',
  'Remove haircut reference': '参考写真を削除',
  'Add a haircut reference photo': 'カットの参考写真を追加',
  'Add haircut reference': '参考写真を追加',

  // ── SelfieCapture ──
  'Starting front camera…': 'フロントカメラを起動中…',
  'Photo requirements': '写真の条件',
  'Face centered': '顔が中央にある',
  'Full hair visible': '髪全体が写っている',
  'Even light': '光が均一',
  'Camera permission is off': 'カメラの権限がオフです',
  'No front camera found': 'フロントカメラが見つかりません',
  'Camera needs a secure connection': 'カメラには安全な接続が必要です',
  'The camera didn’t start': 'カメラを起動できませんでした',
  'Allow camera access in your browser settings, then try again.':
    'ブラウザの設定でカメラへのアクセスを許可してから、もう一度お試しください。',
  'You can retry the camera or upload a clear front-facing photo.':
    'カメラをもう一度試すか、正面を向いた鮮明な写真をアップロードしてください。',
  'Try camera again': 'カメラをもう一度試す',
  'Upload an image': '画像をアップロード',
  'Match my best hairstyles': '似合う髪型を見つける',

  // ── Selfie quality check (verdict messages) ──
  'Move slightly closer': 'もう少し近づいてください',
  'Use even lighting': '光が均一な場所で撮ってください',
  'Face the camera': 'カメラのほうを向いてください',
  'Hairline not visible': '生え際が写っていません',

  // ── Chair: angle vocabulary + coaching ──
  'Left profile': '左横顔',
  'Left ¾': '左斜め',
  'Front': '正面',
  'Right ¾': '右斜め',
  'Right profile': '右横顔',
  'Back##angle': '後ろ',
  'Sideburn, ear line, left temple': 'もみあげ、耳まわり、左のこめかみ',
  'How the fade reads walking up': '近づいたときのフェードの見え方',
  'Fringe, part, hairline': '前髪、分け目、生え際',
  'Sideburn, ear line, right temple': 'もみあげ、耳まわり、右のこめかみ',
  'Neckline, crown, weight line': '襟足、つむじ、重みのライン',
  'Look straight into the camera': 'カメラをまっすぐ見てください',
  'Now start turning — slow and steady': 'ゆっくり回り始めてください',
  'Keep going, all the way around': 'そのまま、一周まわってください',
  'And back to the front': '正面に戻ってください',

  // ── Chair mode (/chair) ──
  'Chair mode': 'チェアモード',
  'Sign in with your barber account to run live try-ons in the chair.':
    'バーバーアカウントでログインすると、席でライブ試着を実行できます。',

  // ── Chair: clients panel ──
  'Chair clients': 'チェアのお客様',
  'Live try-ons you ran in the chair, filed under each client’s name.':
    '席で実行したライブ試着を、お客様の名前ごとに保存しています。',
  'Nothing yet — open Chair Mode when your next client sits down.':
    'まだ記録はありません。次のお客様が座ったらチェアモードを開きましょう。',
  'Open Chair Mode →': 'チェアモードを開く →',
  'Approved': '承認済み',
  'Take': 'テイク',
  '{angle} reference for {name}': '{name}の{angle}の参考写真',
  'Play the take': 'テイクを再生',
  'No takes recorded for this client.': 'このお客様のテイクはまだありません。',
  'Erase {name}’s takes, photos and record? This can’t be undone.':
    '{name}のテイク・写真・記録を消去しますか？この操作は取り消せません。',
  'Erasing…': '消去中…',
  'Erase everything': 'すべて消去',
  'Keep': '残す',
  'Delete this client’s data': 'このお客様のデータを削除',

  // ── Chair station (live take) ──
  'Give this client a name so the cut files under it.':
    'カットを保存する名前を入力してください。',
  'That name’s too long.': '名前が長すぎます。',
  'Couldn’t start that client.': 'このお客様を開始できませんでした。',
  'Couldn’t save that. Try again.': '保存できませんでした。もう一度お試しください。',
  // Runtime errors raised as English strings (useChairTake / lucy/recorder)
  // and translated where they are rendered.
  'Couldn’t open the camera. Check the browser’s camera permission.':
    'カメラを起動できませんでした。ブラウザのカメラ権限を確認してください。',
  'Couldn’t reach the live model. Check the shop’s wifi.':
    'ライブモデルに接続できませんでした。店舗のWi-Fiを確認してください。',
  'That’s every live take for today. They reset tomorrow morning.':
    '本日のライブテイクはすべて使い切りました。明朝リセットされます。',
  'Live takes are paused for this month.': '今月はライブテイクを停止しています。',
  'Couldn’t start that take.': 'テイクを開始できませんでした。',
  'That’s a lot of takes at once — give the mirror a minute, then go again.':
    'テイクが続いています — ミラーを少し休ませてから、もう一度どうぞ。',
  'Your session timed out. Sign in again to keep going.':
    'セッションの有効期限が切れました。もう一度サインインしてください。',
  'That’s a lot at once — give it a moment and try again.':
    '操作が集中しています — 少し待ってからもう一度お試しください。',
  'This browser can’t record video. Try Chrome or Safari.':
    'このブラウザは録画に対応していません。ChromeまたはSafariをお試しください。',
  'The take played but didn’t save. The angles below still work.':
    'テイクは再生できましたが保存されませんでした。下のアングルはそのまま使えます。',
  // Fallbacks for when the vendor hands back no message of its own
  // (lucy/session.ts errorMessage, useChairTake recorder catch).
  'The live connection dropped. Start the take again.':
    'ライブ接続が切断されました。もう一度テイクを開始してください。',
  'Couldn’t record that take.': 'テイクを録画できませんでした。',
  'My card': 'マイカード',
  'Cancel take': 'テイクを中止',
  'Chair': 'チェア',
  'Live takes left today': '本日の残りテイク数',
  '{n} left today': '本日あと{n}回',
  'Next client': '次のお客様',
  'Setting up your chair…': 'チェアを準備しています…',
  'New client': '新しいお客様',
  'Who’s in the chair?': '席にいるのはどなたですか？',
  'Marcus T.': '山田 T.',
  'Starting…': '開始中…',
  'Start': '開始',
  'Before we film': '撮影の前に',
  'We’ll film about 30 seconds of you in the chair and show your face with the haircut applied, so your barber can see it from every angle.':
    '席に座ったあなたを約30秒撮影し、髪型を反映した映像を表示します。担当者があらゆる角度から確認できます。',
  'The clip and the reference photos are saved to your barber’s account under your name. Ask them to delete it any time and it’s gone.':
    '映像と参考写真は、担当者のアカウントにあなたの名前で保存されます。いつでも削除を依頼でき、その場で消去されます。',
  'I agree — let’s see it': '同意します — 見てみる',
  'Let’s do it!': 'はじめましょう！',
  'No thanks': '今回はやめておく',
  'Pick a cut': 'カットを選ぶ',
  'Show fewer': '表示を減らす',
  'Full menu ({n} cuts)': 'メニュー全体（{n}件）',
  'Full menu': 'メニュー全体',
  Suggested: 'おすすめ',
  'Why these?': 'この理由は？',
  'Hide reasons': '理由を隠す',
  '{n}% sure': '確度{n}%',
  'House favourite': '店の定番',
  // Face-shape read — barber-facing only, never shown to the client.
  'Balanced##face': 'バランス型',
  Rounder: '丸みが強い',
  Longer: '面長',
  'Strong jaw': 'エラが張っている',
  'Wider forehead': '額が広い',
  'Wide cheekbones': '頬骨が張っている',
  // Why a cut was suggested — see src/lib/chair/recommend.ts.
  'Height on top lengthens a rounder face': 'トップの高さが丸顔を縦に見せます',
  'Keeps height down so the face doesn’t read longer':
    'トップを抑えて顔がより長く見えないようにします',
  'Width at the sides balances a longer face': 'サイドの幅が面長とのバランスを取ります',
  'Tight sides keep a rounder face from reading wider':
    'サイドを締めて丸顔が広く見えないようにします',
  'A fringe shortens a longer face': '前髪が面長を短く見せます',
  'An open forehead adds length to a rounder face': '額を出すと丸顔に縦の長さが出ます',
  'Blunt lines give a finer jaw definition': '直線的なラインが細い輪郭に輪郭を与えます',
  'Soft texture instead of hard lines, against a strong jaw':
    '硬いラインではなく柔らかい質感で、張ったエラをやわらげます',
  'Hair at the cheeks fills out a narrower chin': '頬まわりの髪が細い顎を補います',
  'Keeps hair off an already strong jaw': 'すでに張ったエラに髪を重ねません',
  'Width at the cheeks balances a wider forehead': '頬の幅が広い額とのバランスを取ります',
  'Keeps weight off the widest part of the face': '顔の一番広い部分にボリュームを置きません',
  'A fringe evens out the forehead': '前髪が額のバランスを整えます',
  'Leaves the forehead open': '額を出したままにします',
  'Or describe it': '言葉で伝える',
  'Tighter on the sides, leave the fringe': 'サイドはタイトに、前髪は残して',
  'Listening…': '聞き取り中…',
  'Dictate instead of typing': '音声で入力',
  'Stop dictation': '音声入力を終了',
  'Cancel dictation': '音声入力をキャンセル',
  'The mic is blocked — allow microphone access in the browser and try again.':
    'マイクがブロックされています。ブラウザでマイクの使用を許可して、もう一度お試しください。',
  'Couldn’t hear you — try the mic again.': '聞き取れませんでした。もう一度マイクをお試しください。',
  'No takes left today': '本日のテイクは残っていません',
  'Start the {n}s take': '{n}秒のテイクを開始',
  'Live try-on': 'ライブ試着',
  'Live preview of the new cut': '新しいカットのライブプレビュー',
  'Getting the mirror ready…': '鏡を準備中…',
  '{n} seconds left in this take': 'このテイクは残り{n}秒',
  'Switch camera': 'カメラを切り替える',
  'Switch the cut live': 'カットをその場で切り替える',
  'Stop early': '途中で終了',
  'Review the take': 'テイクを確認',
  'That’s {cut}. Is that it?': '{cut}です。これで合っていますか？',
  'Yes — that’s the one': 'はい、これです',
  'Try another': '別のを試す',
  'Filed under {name}': '{name}として保存しました',
  '{n} reference angles saved. It’s on your card’s dashboard whenever you need it.':
    '{n}件の参考アングルを保存しました。カードのダッシュボードからいつでも確認できます。',
  'Open dashboard': 'ダッシュボードを開く',
  'Nothing usable came out of that take.': 'このテイクからは使えるコマが得られませんでした。',
  // ── the live mirror on a barber card (BarberLiveTryOn) ──
  'Try it on live': 'ライブで試す',
  'Before the camera starts': 'カメラを始める前に',
  'We’ll film about 30 seconds of you and show your face with the haircut applied, live, so you can see it move.':
    '約30秒間撮影し、その髪型を適用したご自身の姿をライブで表示します。動いたときの見え方まで確認できます。',
  'The clip is saved to {name}’s ShapeUp account under your name. Ask them to delete it any time and it’s gone.':
    '映像はあなたの名前で{name}さんのShapeUpアカウントに保存されます。削除を依頼すればいつでも消せます。',

  // ── consent: what the 30 seconds are for, and the diagram under it ──
  'The next step will use the camera to style your hair. You have 30 seconds to explore which hairstyles fit you best! Use the prompt box and suggestions below to style.':
    '次のステップではカメラを使って髪型を試します。30秒間、自分に似合う髪型を自由に探してみてください。入力欄と下の候補から指示を出せます。',
  'A sketch of the next screen: your camera on the left, the same view with the haircut on the right, a prompt box under both, and cut suggestions below that.':
    '次の画面の図解です。左が自分のカメラ、右が同じ映像に髪型を適用したもの、その下に入力欄、さらに下に髪型の候補が並びます。',
  'A sketch of the screen — not a preview of your result.':
    '画面の図解です。実際の仕上がりのプレビューではありません。',
  'With the cut': '髪型を適用',
  'You##camera': '自分',
  'Live##camera': 'ライブ',
  'Couldn’t start that. Try again.': '開始できませんでした。もう一度お試しください。',
  'Your camera, before the haircut is applied': '髪型を適用する前のカメラ映像',
  'Anything you want different?': '変えたいところはありますか？',
  'Tighter on the sides, keep the fringe…': 'サイドはもっと短く、前髪は残して…',
  'The mirror’s had a busy day — try tomorrow': '本日の枠は終了しました。また明日お試しください',
  'You can change the cut, or say what you want, while it’s running.':
    '撮影中でも髪型を変えたり、希望を入力したりできます。',
  'You, live, with the new cut': '新しい髪型のライブ映像',
  'Say it while you watch — “shorter on top”': '見ながら入力 —「トップをもっと短く」',
  'Change the cut while it’s running': '撮影中に髪型を変更',
  'Say what you want': '希望を伝える',
  'The chair, before any haircut is applied': '髪型を適用する前のチェアの映像',
  'Nothing running yet — the {n} seconds start when you pick a cut or say what you want.':
    'まだ始まっていません。カットを選ぶか希望を伝えると、{n}秒のカウントが始まります。',
  'Stop': '停止',
  'That’s the one': 'これで決まり',
  'That’s {cut}. Send it to {name}?': 'こちらが{cut}です。{name}さんに送りますか？',
  'Send to {name}': '{name}さんに送る',
  'Couldn’t send that — show them this clip in the chair instead.':
    '送信できませんでした。この映像を席で直接見せてください。',
  'Try another cut': '別の髪型を試す',
  'Preparing the live mirror': 'ライブミラーを準備中',
  'Clients often leave before finishing a take — tell them it’s 30 seconds and they can watch it live.':
    'お客様が撮影を最後まで進めないことが多いようです。30秒で終わること、その場で映像を見られることを伝えてみてください。',

  // ── chair: visit records & the last-time card ──
  'Last visit': '前回の来店',
  'Last time': '前回',
  'Reference from the last visit': '前回の参考写真',
  'No cut on file': '記録された髪型はありません',
  'Same again': '前回と同じ',
  'For next time (optional)': '次回のために（任意）',
  'Quick facts': 'クイックメモ',
  'Note for next time': '次回へのメモ',
  'Went 0.5 lower on the sides than usual': 'サイドをいつもより0.5短くした',
  'Save note': 'メモを保存',
  'Noted — it’ll be here next visit': '保存しました。次回の来店時に表示されます',
  'Taper': 'テーパー',
  'Line up': 'ラインアップ',
  'Beard trim': 'ヒゲ整え',
  'Scissors': 'ハサミ仕上げ',

  // ── barber dashboard (/barber tabs) ──
  'Card': 'カード',
  'Studio': 'スタジオ',
  'Dashboard sections': 'ダッシュボードのセクション',
  'Open the chair': 'チェアを開く',
  'Your barber dashboard': 'バーバーダッシュボード',
  'Sign in to run the chair, keep every client’s reference shots, and manage your card.':
    'サインインして、チェアの操作、お客様ごとの参考写真の保存、カードの管理を行いましょう。',
  'Today': '本日',
  'Welcome': 'ようこそ',
  'Set up your barber card first — it’s your public page, and it’s what the chair files clients under.':
    'まずバーバーカードを設定してください。あなたの公開ページであり、チェアがお客様を記録する場所です。',
  'Set up my card': 'カードを設定する',
  'The chair': 'チェア',
  'Live mirror, reference angles, filed under the client’s name — about a minute per customer.':
    'ライブミラーで映して、参考アングルをお客様の名前で保存。1人あたり約1分です。',
  'Appointments today': '本日の予約',
  'Nothing on the books today — walk-ins go straight to the chair.':
    '本日の予約はありません。飛び込みのお客様はそのままチェアへ。',
  'Booking is off. Turn it on in your card to take appointments here.':
    '予約機能はオフです。カードでオンにするとここに予約が表示されます。',
  'Seat in the chair': 'チェアに案内',
  'Recent clients': '最近のお客様',
  '{n} takes left today': '本日残り{n}回',
  'Search by name or phone': '名前または電話番号で検索',
  'Search clients': 'お客様を検索',
  'No client matches “{q}”.': '「{q}」に一致するお客様はいません。',
  'Notes on file': 'メモあり',
  'Walk-in': '飛び込み',
  'That client isn’t in your book any more.': 'このお客様はもう台帳にありません。',
  'All clients': 'すべてのお客様',
  'Client since {date}': '{date}からのお客様',
  'Joined from your card': 'カード経由で登録',
  'Filming consent on file · {date}': '撮影同意 記録済み · {date}',
  'No filming consent yet — the chair will ask first':
    '撮影同意はまだです。チェアで最初に確認します',
  'Call': '電話',
  'Text': 'SMS',
  'Book their next visit ↗': '次回の予約を取る ↗',
  'Book next visit ↗': '次回を予約 ↗',
  'Preferences': 'こだわりメモ',
  'Prefers scissors over clippers. Sensitive around the ears.':
    'バリカンよりハサミ派。耳まわりは敏感。',
  'Save preferences': 'こだわりメモを保存',
  'Visits': '来店履歴',
  'No visits on record yet — their first chair session will land here.':
    'まだ来店記録がありません。最初のチェアセッションがここに表示されます。',
  'All takes': 'すべての撮影',
  'Passed on': '見送り',
  'Show all {n} takes': '{n}件すべて表示',
  // ── the day's pulse on Today ──
  'Today vs a normal day': '本日といつもの一日',
  'Normal day': 'いつもの日',
  'Clients in the chair by hour, today against a normal day':
    '時間帯ごとのチェア来店数（本日といつもの日の比較）',
  'Hour': '時間',
  '{n} in the chair so far — a normal day has {m} by now.':
    '現在までに{n}人。いつもの日ならこの時間で{m}人です。',
  '{n} in the chair so far. A few more days in the chair and the normal-day line fills in.':
    '現在までに{n}人。数日分たまると「いつもの日」の線が表示されます。',
  'The chair this week': '今週のチェア',
  'Chair visits': 'チェアの来店数',
  'Clients seen': '対応したお客様',
  'Came back': 'リピート',
  'Live takes': 'ライブ撮影',
  'Most tried in the mirror': 'ミラーで最も試された髪型',
  'No takes yet this week.': '今週はまだ撮影がありません。',
  'Most chosen': '最も選ばれた髪型',
  'Nothing approved yet this week.': '今週はまだ承認がありません。',
  'Last 7 days': '過去7日間',
  'What your card and your chair did this week.': '今週のカードとチェアの実績です。',
  'Set up your barber card first — insights start once it’s live.':
    'まずバーバーカードを設定してください。公開するとインサイトが始まります。',
  'Your card’s numbers, appointments and client requests now live under':
    'カードの数字・予約・お客様のリクエストは、こちらに移動しました：',
  'Already set up? Open your dashboard →': '設定済みの方はダッシュボードへ →',
  'Trying a cut on yourself? Start here →': '自分で髪型を試したい方はこちら →',

  // ── calendar tab + insights charts ──
  'Calendar': 'カレンダー',
  'Set up your barber card first — appointments book through it.':
    'まずバーバーカードを設定してください。予約はカード経由で入ります。',
  'Edit hours': '営業時間を編集',
  'Previous week': '前の週',
  'This week##calendar': '今週',
  'Next week': '次の週',
  'Appointments, week of {range}': '{range}の週の予約',
  'No appointments this week — slots are live on your card.':
    '今週の予約はありません。予約枠はカードで公開中です。',
  'Example week': '見本の週',
  'Appointment details': '予約の詳細',
  'Phone': '電話番号',
  'What they asked for': 'ご要望',
  'The faded blocks are an example of how a booked week looks.':
    '薄く表示されているのは、予約が入った週の見本です。',
  // example-week services
  'Skin fade + line-up': 'スキンフェード＋ライン入れ',
  'Scissor cut': 'シザーカット',
  'Taper + beard': 'テーパー＋ヒゲ',
  'Buzz cut': '丸刈り',
  'Mid fade': 'ミッドフェード',
  'Kids cut': 'キッズカット',
  'Fade + design': 'フェード＋デザイン',
  'Line-up': 'ライン入れ',
  'Textured crop': 'テクスチャークロップ',
  'Hot towel shave': 'ホットタオルシェーブ',
  'Trim + wash': 'カット＋シャンプー',
  'Takes approved': '承認された撮影',
  'Chair activity, last 14 days': 'チェアの利用状況（過去14日間）',
  'Last 14 days': '過去14日間',
  'Date': '日付',
  'Tried vs chosen, last 7 days': '試された髪型と選ばれた髪型（過去7日間）',
  'Tried vs chosen': '試された vs 選ばれた',
  'Tried in the mirror': 'ミラーで試された',
  'Chosen': '選ばれた',
  'Cut': '髪型',

  // ── chair: background save + scrap session ──
  'See your next cut on you, live': '次の髪型を、自分の顔でライブで',
  'Clients get a live mirror here — these are the cuts it will suggest.':
    'お客様はここでライブミラーを使えます。提案される髪型はこちらです。',
  'Before we film, {name}': '撮影の前に、{name}さん',
  'None of these — save nothing': 'どれも違う — 何も保存しない',
  'Save failed': '保存に失敗しました',
  'Couldn’t save that take': 'この撮影を保存できませんでした',
  'The clip is still here. Check the connection and try again.':
    '映像はまだ残っています。接続を確認してもう一度お試しください。',
  'Try saving again': 'もう一度保存する',
  'Scrap it — save nothing': '破棄する — 何も保存しない',
  'Saving under {name}…': '{name}さんの記録に保存中…',
  'The reference angles are filing themselves in the background — no need to wait.':
    '参考アングルはバックグラウンドで自動保存されます。待つ必要はありません。',
  'Takes are running but none got kept — when a look lands, “that’s the one” files the reference for next visit.':
    '撮影はあるのに保存がありません。気に入った髪型が決まったら「これで決まり」で次回用の参考が保存されます。',

  // ── the hairstyle catalog (src/data/hairstyles.ts) ──
  // Salon-counter Japanese, not literal translation: the name a client would
  // actually say in the chair (マッシュ, ツーブロック, 韓国風パーマ, 切りっぱなし,
  // カーテンバング…) rather than a transliteration of the English.
  // Keep the English shape — `<name>, <detail>` — using the full-width comma
  // 、so chip labels can still cut at the first comma (see LiveTryOnPreview).
  // hairstyles.test.ts pins every catalog label to an entry here.
  // men's
  'low taper fade, textured fringe': 'ローフェード、束感の前髪',
  'textured crop, skin fade': 'クロップスタイル、スキンフェード',
  'modern mullet, faded sides': 'マレットヘア、サイド刈り上げ',
  'blowout taper': 'ブローアウトテーパー、トップふんわり',
  'edgar cut, high fade': 'エドガーカット、ハイフェード',
  'wolf cut, light layers': 'ウルフカット、軽めレイヤー',
  'curtain fringe, mid fade': 'センターパート、ミッドフェード',
  'comma hair, low taper': 'コンマヘア、ローテーパー',
  'afro taper, sponge curls': 'アフロテーパー、スポンジパーマ',
  'two block, soft layers': 'ツーブロック、韓国風レイヤー',
  'slick back undercut': 'オールバック、アンダーカット',
  'side part pompadour': '七三ポンパドール、サイドタイト',
  'french crop, hard part': 'フレンチクロップ、剃り込みパート',
  'mid taper with waves': 'ミッドテーパー、360ウェーブ',
  'buzz cut, clean line-up': '丸刈り、ライン入れ',
  'fluffy crop, low fade': 'ふんわりマッシュ、ローフェード',
  'wavy perm, middle part': '波巻きパーマ、センターパート',
  'broccoli perm, taper fade': 'ブロッコリーパーマ、テーパーフェード',
  'textured mod, fringe': 'モードマッシュ、重め前髪',
  'k-pop perm, curtain bangs': '韓国風パーマ、センターパート前髪',
  'burst fade, textured fringe': 'バーストフェード、束感の前髪',
  'bro flow, swept back': 'かき上げヘア、センター分け',
  'twist out, taper': 'ツイストスパイラルパーマ、テーパー',
  'caesar cut, textured fringe': 'シーザーカット、束感の前髪',
  'spiky eboy, mid fade': 'ツンツン束感ヘア、ミッドフェード',
  'perm mullet, taper fade': 'パーマウルフ、テーパーフェード',
  // women's
  'long layers, curtain bangs': 'ロングレイヤー、カーテンバング',
  'collarbone bob, soft waves': '鎖骨ボブ、ゆるふわウェーブ',
  'shaggy wolf cut, wispy ends': 'シャギーウルフ、毛先エアリー',
  'blunt lob, center part': '切りっぱなしロブ、センターパート',
  'butterfly layers, face framing': 'バタフライレイヤー、顔まわりレイヤー',
  'french bob, micro fringe': 'フレンチボブ、オン眉前髪',
  'beachy waves, long layers': '波巻きウェーブ、ロングレイヤー',
  'pixie cut, textured crop': 'ベリーショート、束感ピクシー',
  'money piece, balayage layers': '顔まわりハイライト、バレイヤージュレイヤー',
  'curly shag, volume on top': 'くるくるシャギー、トップふんわり',
  'sleek straight, middle part': '艶さらストレート、センターパート',
  'choppy bixie cut': 'ハンサムショート、束感ビクシー',
  'feathered layers, side bangs': 'フェザーレイヤー、流し前髪',
  'voluminous blowout, soft curls': 'ふんわり内巻きブロー、ゆるカール',
  'half-up bun, loose waves': 'ハーフアップお団子、ゆるウェーブ',
  'jellyfish cut, blunt crown': 'クラゲカット、トップ切りっぱなし',
  'butterfly blowout, curtain bangs': 'バタフライブロー、カーテンバング',
  'birkin layers, wispy bangs': 'バーキンレイヤー、シースルーバング',
  'italian bob, blunt ends': 'イタリアンボブ、切りっぱなしの毛先',
  'octopus cut, choppy layers': 'オクトパスカット、束感レイヤー',
  'hush cut, curtain bangs': 'ハッシュカット、カーテンバング',
  'C-curl perm, shoulder length': 'Cカールパーマ、ミディアム',
  'spiral perm, voluminous curls': 'スパイラルパーマ、ふんわりカール',
  'soft body perm, long layers': 'ゆるふわパーマ、ロングレイヤー',
  'modern shag, micro bangs': 'モードシャギー、オン眉前髪',
  'mixie cut, textured pixie': 'ミクシーカット、束感ショート',

  // ── the 60-second take + the review-screen reference sheet ──
  '60 seconds': '60秒',
  'We’ll film up to 3 minutes of you in the chair and show your face with the haircut applied, so your barber can see it from every angle.':
    '椅子に座ったあなたを最大3分間撮影し、ヘアカットを適用した顔を映します。バーバーがあらゆる角度から確認できます。',
  'The next step will use the camera to style your hair. You have up to 3 minutes to explore which hairstyles fit you best! Use the prompt box and suggestions below to style.':
    '次のステップではカメラを使ってヘアスタイルを試します。最大3分間、どの髪型が一番似合うか試せます！下の入力欄とおすすめを使ってスタイリングしてください。',
  'We’ll film up to 3 minutes of you and show your face with the haircut applied, live, so you can see it move.':
    '最大3分間あなたを撮影し、ヘアカットを適用した顔をライブで映します。動きも確認できます。',
  'Reference shots': 'リファレンスショット',
  'Reading the take for the sharpest angles…':
    'テイクを解析して最も鮮明なアングルを探しています…',
  'Couldn’t read reference shots out of this take. You can still keep the cut.':
    'このテイクからリファレンスショットを抽出できませんでした。それでもカットは保存できます。',
  'No clear frames in that take — try another with steadier light.':
    'このテイクには鮮明なフレームがありません。より安定した光でもう一度お試しください。',
  'Tap the 2–4 shots the barber should cut from.':
    'バーバーがカットの参考にする写真を2〜4枚タップしてください。',
  'The camera couldn’t verify these angles — check them before you save.':
    'カメラでこれらのアングルを確認できませんでした。保存する前にご確認ください。',
  'Reading the take…': 'テイクを解析中…',
  '{n} reference shots saved under this client.':
    'この顧客に{n}枚のリファレンスショットを保存しました。',
  'Sign in to build your card and run live try-ons in the chair.':
    'サインインしてカードを作成し、チェアでライブ試着を行いましょう。',
};

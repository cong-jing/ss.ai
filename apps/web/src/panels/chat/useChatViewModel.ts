import { ref, watch } from "vue";
import { apiDryRunChat, apiSendChatMessage, apiStreamChatMessage } from "./chatApi";
import type { ChatMessage } from "./chatTypes";
import { contextVersion } from "../../shared/state/appState";

function createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DUMMY_EXCHANGES: { user: string; assistant: string }[] = [
    { user: "こんにちは！調子はどう？", assistant: "元気だよ！今日は何か手伝えることある？" },
    { user: "おすすめの映画を教えて", assistant: "最近だと「オッペンハイマー」が話題だったよ。歴史好きならおすすめ！" },
    { user: "Pythonでリストを逆順にする方法は？", assistant: "`my_list[::-1]` か `list(reversed(my_list))` でできるよ。" },
    { user: "今日の天気どう思う？", assistant: "私にはリアルタイム情報がないけど、外に出る前に天気アプリを確認してみてね。" },
    { user: "JavaScriptのPromiseって何？", assistant: "非同期処理の結果を表すオブジェクトだよ。`.then()` や `async/await` で扱えるよ。" },
    { user: "おいしいパスタの作り方は？", assistant: "塩を多めに入れたお湯でアルデンテに茹でるのがコツ！ソースと絡める時間も大切だよ。" },
    { user: "TypeScriptのメリットは？", assistant: "型安全性が高まって、大規模プロジェクトでのバグを減らせるのが一番のメリットかな。" },
    { user: "読書おすすめある？", assistant: "「ハリー・ポッター」シリーズや「銃・病原菌・鉄」は幅広い人に楽しまれてるよ。" },
    { user: "Gitのrebaseとmergeはどこが違う？", assistant: "mergeはブランチの履歴を保持、rebaseはコミット履歴を整理してきれいにするイメージだよ。" },
    { user: "Vue 3のComposition APIとは？", assistant: "ロジックをコンポーネントから分離して再利用できるようにするAPIだよ。`setup()`関数の中で書くよ。" },
    { user: "コーヒーと紅茶どっちが好き？", assistant: "どちらもそれぞれの良さがあるね！朝はコーヒー、午後は紅茶って使い分ける人も多いよ。" },
    { user: "CSSでflex centerするには？", assistant: "`display: flex; justify-content: center; align-items: center;` の3行でできるよ。" },
    { user: "機械学習って難しい？", assistant: "基礎の数学と統計は必要だけど、最近はライブラリが充実してて入門しやすくなってるよ。" },
    { user: "Reactとどっちが好き？", assistant: "VueはテンプレートがHTMLに近くて直感的、ReactはJSXで柔軟性が高い。好みによるね！" },
    { user: "睡眠の質を上げるコツは？", assistant: "就寝前のスマホを控えて、部屋を暗くして一定の時間に寝るのが効果的だよ。" },
    { user: "Node.jsとDenoはどちらがいい？", assistant: "Nodeはエコシステムが成熟していて安定、Denoはセキュリティとモダンさが売りだよ。" },
    { user: "英語の勉強法を教えて", assistant: "毎日少しずつ触れることが大事！映画や音楽を英語で楽しむのもおすすめだよ。" },
    { user: "SQLのJOINの種類は？", assistant: "INNER、LEFT、RIGHT、FULL OUTER JOINの4種類が基本だよ。用途によって使い分けてね。" },
    { user: "モチベーションが上がらない時は？", assistant: "小さなタスクから始めて達成感を積み上げるのが効果的だよ。完璧を求めすぎないことも大切！" },
    { user: "Dockerって何に使うの？", assistant: "アプリを環境ごとにコンテナに閉じ込めることで、どこでも同じ動作を保証できるよ。" },
    { user: "なぜプログラマーはコーヒーを飲むの？", assistant: "Java（ジャバ）はコーヒーの種類でもあるから...冗談はともかく、長時間集中するためかな！" },
    { user: "おすすめのプログラミング言語は？", assistant: "目的による！Web開発ならJS/TS、データ分析ならPython、システム系ならGoやRustがいいよ。" },
    { user: "ストレス発散法は？", assistant: "運動、音楽、散歩、好きな趣味に没頭するのがおすすめ。自分に合った方法を見つけてね。" },
    { user: "APIとは何ですか？", assistant: "アプリケーション同士が会話するための「窓口」みたいなものだよ。HTTPを通じてデータをやり取りするよ。" },
    { user: "Viteって速いの？", assistant: "めちゃくちゃ速い！ESモジュールをそのまま使うからビルドのオーバーヘッドがほぼないよ。" },
    { user: "プログラムのデバッグのコツは？", assistant: "コンソールログより一歩進んでデバッガーを使おう。ブレークポイントで状態を確認するのが効率的だよ。" },
    { user: "健康的な食事って？", assistant: "彩り豊かな野菜を中心に、タンパク質と炭水化物のバランスを意識するといいよ。" },
    { user: "チームで開発する時に大事なことは？", assistant: "コミュニケーションとコードレビュー文化が鍵！あと共通のコーディング規約も大切だよ。" },
    { user: "再帰関数って何？", assistant: "自分自身を呼び出す関数だよ。ベースケースを必ず設定しないと無限ループになるから注意！" },
    { user: "テストコードを書く理由は？", assistant: "リファクタリング時の安心感と、仕様のドキュメントにもなるよ。長期的に開発速度が上がるよ。" },
    { user: "クラウドとは？", assistant: "インターネット越しに使えるサーバーやストレージなどのコンピュータリソースのことだよ。" },
    { user: "趣味はある？", assistant: "私はAIなので趣味はないけど、あなたの趣味について話してくれると嬉しいな！" },
    { user: "マイクロサービスとは？", assistant: "大きなアプリを小さな独立したサービスに分割するアーキテクチャだよ。スケールしやすいのがメリット。" },
    { user: "async/awaitはどう使う？", assistant: "`async`関数内で`await`を使うと非同期処理を同期っぽく書けるよ。エラーは`try/catch`でね。" },
    { user: "おすすめのエディタは？", assistant: "VS Codeが一番人気！拡張機能が豊富で、あらゆる言語に対応してるよ。" },
    { user: "デザインパターンを学ぶべき？", assistant: "チームでの共通語になるし、設計の選択肢が広がるよ。GoFの23パターンが有名だよ。" },
    { user: "バグとエラーの違いは？", assistant: "エラーはランタイムが検出する問題、バグは意図しない動作のこと。バグはエラーにならないこともあるよ。" },
    { user: "最近嬉しかったことは？", assistant: "あなたと話せていること、かな！何か私に話したいことがあれば聞かせてね。" },
    { user: "GraphQLとRESTの違いは？", assistant: "RESTはエンドポイントごとにリソースを固定、GraphQLはクライアントが必要なデータを選べるよ。" },
    { user: "Linuxコマンドを覚えるコツは？", assistant: "毎日ターミナルで作業して、man コマンドでドキュメントを読む習慣をつけるといいよ。" },
    { user: "ゲームは好き？", assistant: "プレイはしないけど、ゲームの設計や仕組みについては興味深く思ってるよ！" },
    { user: "セキュリティで一番大事なことは？", assistant: "入力の検証とサニタイズ、そして最小権限の原則かな。SQLインジェクションは今でも多いよ。" },
    { user: "TypeScriptでgenericsはどう使う？", assistant: "`function identity<T>(arg: T): T { return arg; }` みたいに型変数で型を柔軟に扱えるよ。" },
    { user: "一番難しいプログラミングの概念は？", assistant: "人によるけど、並行処理・非同期・関数型プログラミングが難しく感じやすいかな。" },
    { user: "仕事と趣味のバランスは？", assistant: "意識的に休憩時間を作ることが大切。燃え尽きないためにオフの時間を大事にしてね！" },
    { user: "CSSアニメーションを使うべき？", assistant: "UIのフィードバックとして適度に使うと良い体験になるよ。過剰にするとうるさくなるけど。" },
    { user: "開発で一番楽しい部分は？", assistant: "動かなかったものが動いた瞬間の達成感！その喜びがエンジニアを続ける原動力になるよね。" },
    { user: "Zodって何に使う？", assistant: "TypeScriptでランタイムのバリデーションをするライブラリだよ。APIレスポンスの検証に便利！" },
    { user: "ソート アルゴリズムのおすすめは？", assistant: "実用的にはTimsortが使われてるけど、学習用にはクイックソートとマージソートを理解しておくといいよ。" },
    { user: "もし人間だったら何がしたい？", assistant: "世界旅行してみたいな！あとおいしいものをいっぱい食べてみたい。あなたは？" },
];

function createDummyMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    let t = Date.now() - DUMMY_EXCHANGES.length * 2 * 60 * 1000;

    for (const exchange of DUMMY_EXCHANGES) {
        messages.push({
            id: createId("user"),
            role: "user",
            content: exchange.user,
            createdAt: new Date(t).toISOString(),
            status: "normal"
        });
        t += 30 * 1000;

        messages.push({
            id: createId("assistant"),
            role: "assistant",
            content: exchange.assistant,
            createdAt: new Date(t).toISOString(),
            status: "normal"
        });
        t += 90 * 1000;
    }

    return messages;
}

export function useChatViewModel() {
    const messages = ref<ChatMessage[]>(createDummyMessages());
    const isSending = ref(false);
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    async function sendMessage(text: string, stream = false) {
        const prompt = text.trim();
        if (!prompt) {
            return;
        }

        messages.value.push({
            id: createId("user"),
            role: "user",
            content: prompt,
            createdAt: new Date().toISOString(),
            status: "normal"
        });

        isSending.value = true;
        error.value = null;

        if (stream) {
            const msgId = createId("assistant");
            messages.value.push({
                id: msgId,
                role: "assistant",
                content: "",
                createdAt: new Date().toISOString(),
                status: "streaming"
            });

            try {
                const result = await apiStreamChatMessage(prompt, (chunk) => {
                    const msg = messages.value.find(m => m.id === msgId);
                    if (msg) msg.content += chunk;
                });

                const msg = messages.value.find(m => m.id === msgId);
                if (msg) {
                    msg.status = "normal";
                    msg.id = result.requestId || msgId;
                }
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.error("[chat/stream] error:", e);
                error.value = message;
                const msg = messages.value.find(m => m.id === msgId);
                if (msg) {
                    msg.content = message;
                    msg.status = "failed";
                }
            } finally {
                isSending.value = false;
            }
            return;
        }

        try {
            const response = await apiSendChatMessage(prompt);
            messages.value.push({
                id: response.requestId,
                role: "assistant",
                content: response.output,
                createdAt: new Date().toISOString(),
                status: "normal"
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("[chat] error:", e);
            error.value = message;
            messages.value.push({
                id: createId("assistant-error"),
                role: "assistant",
                content: message,
                createdAt: new Date().toISOString(),
                status: "failed"
            });
        } finally {
            isSending.value = false;
        }
    }

    function clearMessages() {
        messages.value = [];
    }

    const showDebug = ref(false);

    async function dryRunPrompt(text: string) {
        const prompt = text.trim();
        if (!prompt) return;

        try {
            const result = await apiDryRunChat(prompt);
            console.group("[dry-run] Assembled prompt messages");
            for (const msg of result.messages) {
                console.log(`--- [${msg.role}] ---`);
                console.log(msg.content);
            }
            console.groupEnd();
            messages.value.push({
                id: createId("debug"),
                role: "debug",
                content: "",
                createdAt: new Date().toISOString(),
                status: "normal",
                debugMessages: result.messages,
            });
            showDebug.value = true;
        } catch (e) {
            console.error("[dry-run] error:", e);
        }
    }

    // Clear messages whenever character or conversation context changes
    watch(contextVersion, () => {
        messages.value = [];
        error.value = null;
    })

    return {
        messages,
        isSending,
        isLoading,
        error,
        showDebug,
        sendMessage,
        clearMessages,
        dryRunPrompt,
    };
}

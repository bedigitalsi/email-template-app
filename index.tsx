
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

type JsonSchema = any;

const ensureNoAdditionalProperties = (schema: JsonSchema): JsonSchema => {
    if (schema === null || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(ensureNoAdditionalProperties);

    const cloned: JsonSchema = { ...schema };
    if (cloned.type === 'object') {
        if (!('additionalProperties' in cloned)) {
            cloned.additionalProperties = false;
        }
        if (cloned.properties && typeof cloned.properties === 'object') {
            cloned.properties = Object.fromEntries(
                Object.entries(cloned.properties).map(([key, value]) => [key, ensureNoAdditionalProperties(value as JsonSchema)])
            );
        }
    }

    if (cloned.type === 'array' && cloned.items) {
        cloned.items = ensureNoAdditionalProperties(cloned.items as JsonSchema);
    }

    return cloned;
};

const buildApiUrl = (path: string) => {
    if (API_BASE_URL) return `${API_BASE_URL}${path}`;
    return path;
};

const runJsonPrompt = async ({
    prompt,
    schema,
    schemaName,
    model = DEFAULT_OPENAI_MODEL,
}: {
    prompt: string;
    schema: JsonSchema;
    schemaName: string;
    model?: string;
}) => {
    const preparedSchema = ensureNoAdditionalProperties(schema);
    const response = await fetch(buildApiUrl('/api/json-prompt'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            schema: preparedSchema,
            schemaName,
            model,
        }),
    });

    if (!response.ok) {
        let message = 'Failed to reach the AI service.';
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch (_) {
            // ignore parse issues
        }
        throw new Error(message);
    }

    const payload = await response.json();
    if (!payload?.result) {
        throw new Error('AI response was empty.');
    }
    return payload.result;
};

type ToastMessage = {
    id: number;
    type: 'info' | 'success' | 'error' | 'warning';
    message: string;
};

type AsyncContextValue = {
    beginTask: (label: string) => () => void;
    runTask: <T>(label: string, fn: () => Promise<T>, options?: { suppressErrorToast?: boolean }) => Promise<T>;
    pushToast: (options: { message: string; type?: ToastMessage['type'] }) => void;
};

const AsyncUIContext = React.createContext<AsyncContextValue | null>(null);

const GlobalStatusOverlay: React.FC<{ active: boolean; message: string }> = ({ active, message }) => (
    <div className={`global-status ${active ? 'active' : ''}`}>
        <div className="global-status-content">
            <span className="global-status-spinner" aria-hidden="true" />
            <span>{message || 'Working...'}</span>
        </div>
    </div>
);

const ToastContainer: React.FC<{ toasts: ToastMessage[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => (
    <div className="toast-container">
        {toasts.map(toast => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
                <span>{toast.message}</span>
                <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">×</button>
            </div>
        ))}
    </div>
);

const AsyncUIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tasks, setTasks] = useState<{ id: number; label: string }[]>([]);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const pushToast = useCallback(({ message, type = 'info' }: { message: string; type?: ToastMessage['type'] }) => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(toast => toast.id !== id));
        }, 4000);
    }, []);

    const beginTask = useCallback((label: string) => {
        const id = Date.now() + Math.random();
        setTasks(prev => [...prev, { id, label }]);
        return () => setTasks(prev => prev.filter(task => task.id !== id));
    }, []);

    const runTask = useCallback(async <T,>(label: string, fn: () => Promise<T>, options?: { suppressErrorToast?: boolean }) => {
        const endTask = beginTask(label);
        try {
            return await fn();
        } catch (error: any) {
            if (!options?.suppressErrorToast) {
                pushToast({
                    type: 'error',
                    message: error?.message || 'Something went wrong. Please try again.',
                });
            }
            throw error;
        } finally {
            endTask();
        }
    }, [beginTask, pushToast]);

    const dismissToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const contextValue = useMemo<AsyncContextValue>(() => ({
        beginTask,
        runTask,
        pushToast,
    }), [beginTask, runTask, pushToast]);

    const activeTask = tasks[tasks.length - 1];
    return (
        <AsyncUIContext.Provider value={contextValue}>
            {children}
            <GlobalStatusOverlay active={tasks.length > 0} message={activeTask?.label || ''} />
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </AsyncUIContext.Provider>
    );
};

const useAsyncUI = () => {
    const ctx = React.useContext(AsyncUIContext);
    if (!ctx) throw new Error('useAsyncUI must be used inside AsyncUIProvider.');
    return ctx;
};

// --- DATA & CONFIGURATION ---

const BRANDS = {
  netscroll: {
    key: "netscroll",
    displayName: "Netscroll",
    logoUrl: "https://www.slike.maneks.eu/wp-content/uploads/2025/10/netscroll-logo-v3.png",
  },
  primepick: {
    key: "primepick",
    displayName: "Primepick",
    logoUrl: "https://www.slike.maneks.eu/wp-content/uploads/2025/10/primepick-logo-v4.png",
  }
};

const MARKETS = {
  si: { key: "si", displayName: "Slovenia", locale: "sl-SI", currency: "EUR" },
  hr: { key: "hr", displayName: "Croatia", locale: "hr-HR", currency: "EUR" },
  sk: { key: "sk", displayName: "Slovakia", locale: "sk-SK", currency: "EUR" },
  cz: { key: "cz", displayName: "Czech Republic", locale: "cs-CZ", currency: "CZK" },
  hu: { key: "hu", displayName: "Hungary", locale: "hu-HU", currency: "HUF" },
  pl: { key: "pl", displayName: "Poland", locale: "pl-PL", currency: "PLN" },
  ro: { key: "ro", displayName: "Romania", locale: "ro-RO", currency: "RON" },
  it: { key: "it", displayName: "Italy", locale: "it-IT", currency: "EUR" },
  de: { key: "de", displayName: "Germany", locale: "de-DE", currency: "EUR" },
  gr: { key: "gr", displayName: "Greece", locale: "el-GR", currency: "EUR" },
  lt: { key: "lt", displayName: "Lithuania", locale: "lt-LT", currency: "EUR" },
  ee: { key: "ee", displayName: "Estonia", locale: "et-EE", currency: "EUR" },
  lv: { key: "lv", displayName: "Latvia", locale: "lv-LV", currency: "EUR" },
  bg: { key: "bg", displayName: "Bulgaria", locale: "bg-BG", currency: "BGN" },
};

const SENDER_PROFILES = {
  netscroll: {
    si: { email: "info@netscroll.si", name: "Netscroll" },
    hr: { email: "info@netscroll.hr", name: "Netscroll" },
    sk: { email: "info@netscroll.sk", name: "Netscroll" },
    cz: { email: "info@netscroll.cz", name: "Netscroll" },
    hu: { email: "info@netscroll.hu", name: "Netscroll" },
    pl: { email: "info@netscroll.pl", name: "Netscroll" },
    ro: { email: "info@netscroll.ro", name: "Netscroll" },
    it: { email: "info@netscroll.it", name: "Netscroll" },
    de: { email: "info@netscroll.de", name: "Netscroll" },
    gr: { email: "info@netscroll.gr", name: "Netscroll" },
    lt: { email: "info@netscroll.lt", name: "Netscroll" },
    ee: { email: "info@netscroll.ee", name: "Netscroll" },
    lv: { email: "info@netscroll.lv", name: "Netscroll" },
    bg: { email: "info@netscroll.bg", name: "Netscroll" },
  },
  primepick: {
    si: { email: "info@primepick.si", name: "Primepick" },
    hr: { email: "info@primepick.hr", name: "Primepick" },
    sk: { email: "info@primepick.sk", name: "Primepick" },
    cz: { email: "info@primepick.cz", name: "Primepick" },
    hu: { email: "info@primepick.hu", name: "Primepick" },
    pl: { email: "info@primepick.pl", name: "Primepick" },
    ro: { email: "info@primepick.ro", name: "Primepick" },
    it: { email: "info@primepick.it", name: "Primepick" },
    de: { email: "info@primepick.de", name: "Primepick" },
    gr: { email: "info@primepick.gr", name: "Primepick" },
    lt: { email: "info@primepick.lt", name: "Primepick" },
    ee: { email: "info@primepick.ee", name: "Primepick" },
    lv: { email: "info@primepick.lv", name: "Primepick" },
    bg: { email: "info@primepick.bg", name: "Primepick" },
  }
};

const DEFAULT_LIST_IDS = {
  primepick: {
    si: '4',
    sk: '5',
    cz: '6',
    ro: '7',
    it: '8',
    pl: '9',
    gr: '10',
    hr: '11',
  },
  netscroll: {
    si: '13',
    hr: '14',
    sk: '15',
    cz: '16',
    pl: '17',
    it: '18',
    ro: '19',
    gr: '20',
  }
};

const SAMPLE_DATA = {
    brandKey: 'netscroll',
    headline: 'Wrap gifts like a pro in 30 seconds',
    description: `Meet the WrapMaster™ electric gift wrapper – the fastest way to create perfect presents. The kit includes premium metallic paper, velvet ribbons, and reusable gift tags so every box looks boutique-ready.\n\n* Auto-wrap technology keeps paper tight & wrinkle-free\n* Built-in ribbon dispenser finishes each gift with a luxe bow\n* Includes matching gift tags and reusable storage case`,
    themeColor: '#ff4d5a',
    isSpecialPrice: true,
    images: [
        'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=60',
        'https://images.unsplash.com/photo-1541547411627-4783abfea5e2?auto=format&fit=crop&w=900&q=60',
        'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=60',
    ],
    markets: ['si', 'hr', 'it'],
    perCountryData: {
        si: { price: 34.99, productUrl: 'https://netscroll.si/products/wrapmaster' },
        hr: { price: 36.99, productUrl: 'https://netscroll.hr/products/wrapmaster' },
        it: { price: 37.99, productUrl: 'https://netscroll.it/products/wrapmaster' },
    },
};


const I18N_STRINGS = {
  si: { view_online: "Ogled v brskalniku", in_stock: "Na zalogi", delivered_by: "Dostavljeno v:", pay_on_delivery: "Plačilo po povzetju", add_to_cart: "Dodaj v košarico", more_about_product: "Več o produktu", fast_tracked_delivery: "Hitra sledljiva dostava", post_and_days: "Pošta Slovenije", returns_14: "14 dni za vračila", easy_returns: "Enostavne reklamacije", local_warehouse: "Slovensko skladišče", no_customs: "Brez carine ali dajatev", sent_to: "Poslano na", edit_profile: "Uredi profil", unsubscribe: "Odjava", store: "Spletna trgovina", pay_on_delivery_methods: "+ ostali načini plačila", delivery_time: "2–4 delovne dni", offer: "Posebna ponudba", savings_info: "Prihranek pri nakupu več kosov je na strani izdelka.", in_stock_shipped_immediately: "Na zalogi, pošljemo takoj", avg_rating: "Povprečna ocena strank: {rating}/5", amazing_price: "NEVERJETNA CENA" },
  hr: { view_online: "Pogled u pregledniku", in_stock: "Na zalihi", delivered_by: "Dostavljeno u:", pay_on_delivery: "Plaćanje pouzećem", add_to_cart: "Dodaj u košaricu", more_about_product: "Više o proizvodu", fast_tracked_delivery: "Brza pratljiva dostava", post_and_days: "Hrvatska pošta", returns_14: "14 dana za povrat", easy_returns: "Jednostavne reklamacije", local_warehouse: "Lokalno skladište", no_customs: "Bez carine i davanja", sent_to: "Poslano na", edit_profile: "Uredi profil", unsubscribe: "Odjava", store: "Web trgovina", pay_on_delivery_methods: "+ ostale metode plaćanja", delivery_time: "2–4 radna dana", offer: "Posebna ponuda", savings_info: "Uštede pri kupnji više komada nalaze se na stranici proizvoda.", in_stock_shipped_immediately: "Na zalihi, šaljemo odmah", avg_rating: "Prosječna ocjena kupaca: {rating}/5", amazing_price: "NEVJEROJATNA CIJENA" },
  pl: { view_online: "Zobacz w przeglądarce", in_stock: "W magazynie", delivered_by: "Dostawa w:", pay_on_delivery: "Płatność przy odbiorze", add_to_cart: "Dodaj do koszyka", more_about_product: "Więcej o produkcie", fast_tracked_delivery: "Szybka śledzona dostawa", post_and_days: "Poczta / kurier", returns_14: "14 dni na zwrot", easy_returns: "Łatwe reklamacje", local_warehouse: "Magazyn w UE", no_customs: "Bez cła i dopłat", sent_to: "Wysłano na", edit_profile: "Edytuj profil", unsubscribe: "Wypisz się", store: "Sklep internetowy", pay_on_delivery_methods: "+ inne metody płatności", delivery_time: "2–4 dni robocze", offer: "Oferta specjalna", savings_info: "Oszczędności przy zakupie wielu sztuk znajdują się na stronie produktu.", in_stock_shipped_immediately: "W magazynie, wysyłamy natychmiast", avg_rating: "Średnia ocena klientów: {rating}/5", amazing_price: "NIESAMOWITA CENA" },
  sk: { view_online: "Zobraziť v prehliadači", in_stock: "Na sklade", delivered_by: "Doručené v:", pay_on_delivery: "Platba na dobierku", add_to_cart: "Pridať do košíka", more_about_product: "Viac o produkte", fast_tracked_delivery: "Rýchle sledované doručenie", post_and_days: "Slovenská pošta", returns_14: "14 dní na vrátenie", easy_returns: "Jednoduché reklamácie", local_warehouse: "Miestny sklad", no_customs: "Bez cla a poplatkov", sent_to: "Odoslané na", edit_profile: "Upraviť profil", unsubscribe: "Zrušiť odber", store: "Internetový obchod", pay_on_delivery_methods: "+ ďalšie spôsoby platby", delivery_time: "2–4 pracovné dni", offer: "Špeciálna ponudba", savings_info: "Úspory pri nákupe viacerých kusov sú na stránke produktu.", in_stock_shipped_immediately: "Na sklade, odosielame ihneď", avg_rating: "Priemerné hodnotenie zákazníkov: {rating}/5", amazing_price: "ÚŽASNÁ CENA" },
  cz: { view_online: "Zobrazit v prohlížeči", in_stock: "Skladem", delivered_by: "Doručeno v:", pay_on_delivery: "Platba na dobírku", add_to_cart: "Přidat do košíku", more_about_product: "Více o produktu", fast_tracked_delivery: "Rychlé sledované doručení", post_and_days: "Česká pošta", returns_14: "14 dní na vrácení", easy_returns: "Snadné reklamace", local_warehouse: "Místní sklad", no_customs: "Bez cla a poplatků", sent_to: "Odesláno na", edit_profile: "Upravit profil", unsubscribe: "Zrušit odběr", store: "Internetový obchod", pay_on_delivery_methods: "+ další platební metody", delivery_time: "2–4 pracovní dny", offer: "Speciální nabídka", savings_info: "Úspory při nákupu více kusů jsou na stránce produktu.", in_stock_shipped_immediately: "Skladem, odesíláme ihned", avg_rating: "Průměrné hodnocení zákazníků: {rating}/5", amazing_price: "ÚŽASNÁ CENA" },
  hu: { view_online: "Megtekintés böngészőben", in_stock: "Raktáron", delivered_by: "Szállítás:", pay_on_delivery: "Utánvétes fizetés", add_to_cart: "Kosárba", more_about_product: "Többet a termékről", fast_tracked_delivery: "Gyors, nyomon követett szállítás", post_and_days: "Magyar Posta", returns_14: "14 napos visszaküldés", easy_returns: "Könnyű reklamáció", local_warehouse: "Helyi raktár", no_customs: "Vám- és illetékmentes", sent_to: "Címzett", edit_profile: "Profil szerkesztése", unsubscribe: "Leiratkozás", store: "Webáruház", pay_on_delivery_methods: "+ egyéb fizetési módok", delivery_time: "2–4 munkanap", offer: "Különleges ajánlat", savings_info: "Több darab vásárlása esetén a megtakarítás a termékoldalon található.", in_stock_shipped_immediately: "Raktáron, azonnal szállítjuk", avg_rating: "Átlagos vásárlói értékelés: {rating}/5", amazing_price: "ELKÉPESZTŐ ÁR" },
  ro: { view_online: "Vizualizați în browser", in_stock: "În stoc", delivered_by: "Livrat în:", pay_on_delivery: "Plata la livrare", add_to_cart: "Adaugă în coș", more_about_product: "Mai multe despre produs", fast_tracked_delivery: "Livrare rapidă cu urmărire", post_and_days: "Poșta Română", returns_14: "14 zile pentru retur", easy_returns: "Reclamații simple", local_warehouse: "Depozit local", no_customs: "Fără taxe vamale", sent_to: "Trimis la", edit_profile: "Editează profilul", unsubscribe: "Dezabonare", store: "Magazin online", pay_on_delivery_methods: "+ alte metode de plată", delivery_time: "2–4 zile lucrătoare", offer: "Ofertă specială", savings_info: "Economiile la achiziționarea mai multor articole se găsesc pe pagina produsului.", in_stock_shipped_immediately: "În stoc, expediem imediat", avg_rating: "Evaluarea medie a clienților: {rating}/5", amazing_price: "PREȚ UIMITOR" },
  it: { view_online: "Visualizza nel browser", in_stock: "Disponibile", delivered_by: "Consegna in:", pay_on_delivery: "Pagamento alla consegna", add_to_cart: "Aggiungi al carrello", more_about_product: "Più sul prodotto", fast_tracked_delivery: "Spedizione rapida tracciabile", post_and_days: "Poste Italiane", returns_14: "14 giorni per il reso", easy_returns: "Reclami facili", local_warehouse: "Magazzino locale", no_customs: "Senza dazi doganali", sent_to: "Inviato a", edit_profile: "Modifica profilo", unsubscribe: "Annulla l'iscrizione", store: "Negozio online", pay_on_delivery_methods: "+ altri metodi di pagamento", delivery_time: "2–4 giorni lavorativi", offer: "Offerta speciale", savings_info: "I risparmi sull'acquisto di più articoli si trovano sulla pagina del prodotto.", in_stock_shipped_immediately: "Disponibile, spediamo subito", avg_rating: "Valutazione media dei clienti: {rating}/5", amazing_price: "PREZZO INCREDIBILE" },
  de: { view_online: "Im Browser anzeigen", in_stock: "Auf Lager", delivered_by: "Geliefert in:", pay_on_delivery: "Zahlung bei Lieferung", add_to_cart: "In den Warenkorb", more_about_product: "Mehr über das Produkt", fast_tracked_delivery: "Schneller verfolgter Versand", post_and_days: "Deutsche Post", returns_14: "14 Tage Rückgaberecht", easy_returns: "Einfache Reklamationen", local_warehouse: "Lokales Lager", no_customs: "Ohne Zoll oder Gebühren", sent_to: "Gesendet an", edit_profile: "Profil bearbeiten", unsubscribe: "Abmelden", store: "Onlineshop", pay_on_delivery_methods: "+ weitere Zahlungsmethoden", delivery_time: "2–4 Werktage", offer: "Sonderangebot", savings_info: "Ersparnisse beim Kauf mehrerer Artikel finden Sie auf der Produktseite.", in_stock_shipped_immediately: "Auf Lager, wir versenden sofort", avg_rating: "Durchschnittliche Kundenbewertung: {rating}/5", amazing_price: "UNGLAUBLICHER PREIS" },
  gr: { view_online: "Προβολή στο πρόγραμμα περιήγησης", in_stock: "Σε απόθεμα", delivered_by: "Παράδοση σε:", pay_on_delivery: "Πληρωμή με αντικαταβολή", add_to_cart: "Προσθήκη στο καλάθι", more_about_product: "Περισσότερα για το προϊόν", fast_tracked_delivery: "Γρήγορη παρακολουθούμενη παράδοση", post_and_days: "ΕΛΤΑ", returns_14: "14 ημέρες για επιστροφές", easy_returns: "Εύκολες διαφημίσεις", local_warehouse: "Τοπική αποθήκη", no_customs: "Χωρίς τελωνείο ή δασμούς", sent_to: "Απεστάλη σ", edit_profile: "Επεξεργασία προφίλ", unsubscribe: "Διαγραφή", store: "Ηλεκτρονικό κατάστημα", pay_on_delivery_methods: "+ άλλες μέθοδοι πληρωμής", delivery_time: "2–4 εργάσιμες ημέρες", offer: "Ειδική προσφορά", savings_info: "Οι εκπτώσεις για την αγορά πολλαπλών τεμαχίων βρίσκονται στη σελίδα του προϊόντος.", in_stock_shipped_immediately: "Σε απόθεμα, αποστέλλουμε αμέσως", avg_rating: "Μέση βαθμολογία πελατών: {rating}/5", amazing_price: "ΑΠΙΣΤΕΥΤΗ ΤΙΜΗ" },
  lt: { view_online: "Peržiūrėti naršyklėje", in_stock: "Sandėlyje", delivered_by: "Pristatoma per:", pay_on_delivery: "Apmokėjimas pristatymo metu", add_to_cart: "Į krepšelį", more_about_product: "Daugiau apie produktą", fast_tracked_delivery: "Greitas sekamas pristatymas", post_and_days: "Lietuvos paštas", returns_14: "14 dienų grąžinimas", easy_returns: "Lengvos pretenzijos", local_warehouse: "Vietinis sandėlis", no_customs: "Be muitų ar mokesčių", sent_to: "Išsiųsta", edit_profile: "Redaguoti profilį", unsubscribe: "Atsisakyti prenumeratos", store: "Internetinė parduotuvė", pay_on_delivery_methods: "+ kiti mokėjimo būdai", delivery_time: "2–4 darbo dienas", offer: "Specialus pasiūlymas", savings_info: "Sutaupyti perkant kelis daiktus galite produkto puslapyje.", in_stock_shipped_immediately: "Sandėlyje, išsiunčiame nedelsiant", avg_rating: "Vidutinis klientų įvertinimas: {rating}/5", amazing_price: "NUOSTABI KAINA" },
  ee: { view_online: "Vaata brauseris", in_stock: "Laos", delivered_by: "Kohaletoimetamine:", pay_on_delivery: "Maksmine kättesaamisel", add_to_cart: "Lisa korvi", more_about_product: "Lisateavet toote kohta", fast_tracked_delivery: "Kiire jälgitav kohaletoimetamine", post_and_days: "Eesti Post", returns_14: "14-päevane tagastusõigus", easy_returns: "Lihtsad kaebused", local_warehouse: "Kohalik ladu", no_customs: "Ilma tolli- ja maksudeta", sent_to: "Saadetud aadressile", edit_profile: "Muuda profiili", unsubscribe: "Tühista tellimus", store: "Veebipood", pay_on_delivery_methods: "+ muud makseviisid", delivery_time: "2–4 tööpäeva", offer: "Eripakkumine", savings_info: "Mitme toote ostmisel kehtivad säästud leiate tootelehelt.", in_stock_shipped_immediately: "Laos, saadame kohe teele", avg_rating: "Keskmine kliendihinnang: {rating}/5", amazing_price: "USKUMATU HIND" },
  lv: { view_online: "Skatīt pārlūkprogrammā", in_stock: "Noliktavā", delivered_by: "Piegāde:", pay_on_delivery: "Apmaksa piegādes brīdī", add_to_cart: "Pievienot grozam", more_about_product: "Vairāk par produktu", fast_tracked_delivery: "Ātra izsekojama piegāde", post_and_days: "Latvijas Pasts", returns_14: "14 dienu atgriešana", easy_returns: "Vienkāršas sūdzības", local_warehouse: "Vietējā noliktava", no_customs: "Bez muitas vai nodevām", sent_to: "Nosūtīts uz", edit_profile: "Rediģēt profilu", unsubscribe: "Anulēt abonementu", store: "Interneta veikals", pay_on_delivery_methods: "+ citas maksājumu metodes", delivery_time: "2–4 darba dienu laikā", offer: "Īpašais piedāvājums", savings_info: "Ietaupījumus, pērkot vairākas preces, varat atrast produkta lapā.", in_stock_shipped_immediately: "Noliktavā, izsūtām nekavējoties", avg_rating: "Vidējais klientu vērtējums: {rating}/5", amazing_price: "NETICAMA CENA" },
  bg: { view_online: "Преглед в браузъра", in_stock: "На склад", delivered_by: "Доставка за:", pay_on_delivery: "Плащане при доставка", add_to_cart: "Добави в количката", more_about_product: "Повече за продукта", fast_tracked_delivery: "Бърза проследима доставка", post_and_days: "Български пощи", returns_14: "14 дни за връщане", easy_returns: "Лесни рекламации", local_warehouse: "Местен склад", no_customs: "Без мита или такси", sent_to: "Изпратено до", edit_profile: "Редактиране на профил", unsubscribe: "Отписване", store: "Онлайн магазин", pay_on_delivery_methods: "+ други методи на плащане", delivery_time: "2–4 работни дни", offer: "Специална оферта", savings_info: "Спестявания при закупуване на няколко артикула можете да намерите на продуктовата страница.", in_stock_shipped_immediately: "На склад, изпращаме веднага", avg_rating: "Средна оценка на клиентите: {rating}/5", amazing_price: "НЕВЕРОЯТНА ЦЕНА" },
};

const DEFAULT_TEMPLATE = {
  id: "tpl_two_up_lifestyle_v1",
  name: "Two-up Lifestyle (Rounded + Shadow)",
  requiredImages: 3,
  html: `<!-- Preheader (hidden) -->
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
  {{brand_name}} – {{product_description_text}}
</div>
<table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f6f6">
  <tr><td align="center">
    <!-- Utility bar -->
    <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
            <td class="section" style="padding-top:12px; padding-bottom:12px;">
                <table role="presentation" width="100%">
                    <tr>
                        <td align="left" style="vertical-align:middle;">
                            <a href="{{cta_url}}" target="_blank"><img src="{{brand_logo_url}}" width="140" alt="{{brand_name}}" style="height:auto; display:block;"></a>
                        </td>
                        <td align="right" style="vertical-align:middle;">
                            <span class="kicker">{{t.offer}}</span>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    <!-- Hero -->
    <table role="presentation" class="container" cellpadding="0" cellspacing="0">
      <tr><td><img src="{{image_1}}" width="600" alt="{{brand_name}} hero" style="width:100%; max-width:600px; height:auto; display:block;"></td></tr>
    </table>
    <!-- Intro / Value -->
    <table role="presentation" class="container" cellpadding="0" cellspacing="0">
      <tr><td class="section">
        <div class="badge">{{t.in_stock}} · {{t.delivered_by}} <span style="font-weight:bold;">{{t.delivery_time}}</span> · {{t.pay_on_delivery}}</div>
        <h1 class="h1 mt-14">{{EMAIL_HEADLINE}}</h1>
        <div class="lead">{{product_description}}</div>
      </td></tr>
    </table>
    <!-- Two-up images -->
    <table role="presentation" class="container" cellpadding="0" cellspacing="0">
      <tr><td class="section center">
        <table role="presentation" class="image-pair" cellpadding="0" cellspacing="0" align="center">
          <tr>
            <td align="center"><a href="{{cta_url}}" target="_blank" class="image-card"><img src="{{image_2}}" alt="Lifestyle 1" width="280"></a></td>
            <td align="center"><a href="{{cta_url}}" target="_blank" class="image-card"><img src="{{image_3}}" alt="Lifestyle 2" width="280"></a></td>
          </tr>
        </table>
      </td></tr>
    </table>
    <!-- CTA -->
    <table role="presentation" class="container block" cellpadding="0" cellspacing="0">
      <tr><td class="section center">
        <div class="h2" style="font-size:22px; margin-bottom:8px;">{{price}}</div>
        <div class="mt-14"><a class="btn" href="{{cta_url}}" target="_blank">{{t.add_to_cart}}</a></div>
        <div class="mt-14"><a class="btn-ghost" href="{{cta_url}}#details" target="_blank">{{t.more_about_product}}</a></div>
      </td></tr>
    </table>
    <!-- Trust row -->
    <table role="presentation" class="container block" cellpadding="0" cellspacing="0">
      <tr><td>
        <table role="presentation" width="100%" class="trust">
          <tr>
            <td class="center"><strong>{{t.fast_tracked_delivery}}</strong><br>{{t.in_stock_shipped_immediately}}</td>
            <td class="center"><strong>{{t.pay_on_delivery}}</strong><br>{{t.pay_on_delivery_methods}}</td>
            <td class="center"><strong>{{t.returns_14}}</strong><br>{{t.easy_returns}}</td>
            <td class="center"><strong>{{t.local_warehouse}}</strong><br>{{t.no_customs}}</td>
          </tr>
        </table>
      </td></tr>
    </table>
    <!-- Footer -->
    <table role="presentation" class="container" cellpadding="0" cellspacing="0">
      <tr><td class="section center small" style="border-top:1px solid #eee;">
        {{t.sent_to}} {subtag:email}. <a href="{modify}{/modify}" target="_blank">{{t.edit_profile}}</a> ·
        <a href="{unsubscribe}{/unsubscribe}" target="_blank">{{t.unsubscribe}}</a> ·
        <a href="{{cta_url}}" target="_blank">{{t.store}}</a>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  css: `/* ===== Reset / Base ===== */
body { margin:0; padding:0; background:#f6f6f6; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:0; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
/* Fix for emoji images in lists */
li img { display: inline-block !important; vertical-align: middle !important; }
a { color:#19A981; text-decoration:none; }
/* ===== Layout ===== */
.wrapper { width:100%; background:#f6f6f6; }
.container { width:100%; max-width:600px; margin:0 auto; background:#ffffff; }
.section { padding:20px; }
.center { text-align:center; }
/* ===== Typography ===== */
.h1 { font-family:Arial, Helvetica, sans-serif; font-size:26px; line-height:1.3; color:#111; margin:0 0 8px 0; }
.h2 { font-family:Arial, Helvetica, sans-serif; font-size:20px; line-height:1.35; color:#111; margin:0 0 10px 0; }
.lead { font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#444; margin:0; }
.small { font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.5; color:#888; }
/* ===== Visual elements ===== */
.badge { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#0a0a0a; background:#E9F8F3; border:1px solid #CBEFE3; padding:6px 10px; border-radius:18px; display:inline-block; }
.block { border:1px solid #eee; border-radius:10px; }
.block + .block { margin-top:12px; }
.kicker { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#64748b; letter-spacing:0.08em; text-transform:uppercase; }
/* ===== Buttons ===== */
.btn { font-family:Arial, Helvetica, sans-serif; display:inline-block; background:#19A981; color:#fff !important; padding:14px 24px; border-radius:6px; font-weight:bold; font-size:16px; }
.btn-ghost { display:inline-block; border:2px solid #19A981; color:#19A981 !important; padding:12px 20px; border-radius:6px; font-weight:bold; }
/* ===== Lists ===== */
.benefits td { vertical-align:top; padding:6px 0; }
.benefits .icon { width:22px; font-size:16px; }
.benefits .text { font-family:Arial, Helvetica, sans-serif; font-size:15px; color:#333; }
/* ===== Lifestyle images side by side ===== */
.image-pair { width:100%; max-width:600px; margin:0 auto; }
.image-pair td { width:50%; padding:6px; }
.image-card { border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); display:block; }
.image-card img { width:100% !important; height:auto !important; display:block; border-radius:12px; }
/* ===== Trust row ===== */
.trust td { padding:10px; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#666; border-right:1px solid #eee; }
.trust td:last-child { border-right:0; }
/* ===== Spacing helpers ===== */
.mt-8 { margin-top:8px; }
.mt-14 { margin-top:14px; }
.mt-18 { margin-top:18px; }
/* ===== Responsive ===== */
@media only screen and (max-width:599px){
  .section { padding:16px !important; }
  .btn, .btn-ghost { width:100% !important; text-align:center !important; box-sizing: border-box !important; }
  .trust td { display:block; border-right:0; border-bottom:1px solid #eee; }
  .trust tr td:last-child { border-bottom:0; }
}`
};

const CARD_TEMPLATE_DETAILED = {
  id: "tpl_detailed_card_v1",
  name: "Detailed Product Card",
  requiredImages: 3,
  html: `<!-- Preheader (hidden) -->
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
  {{brand_name}} – {{product_description_text}}
</div>
<table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f6f6">
  <tr>
    <td align="center">
      <!-- Utility bar: Logo left, offer right -->
      <table role="presentation" class="container utility" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section" style="padding-top:12px; padding-bottom:12px;">
            <table role="presentation" width="100%">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <a href="{{cta_url}}" target="_blank">
                    <img src="{{brand_logo_url}}" width="140" alt="{{brand_name}}" style="height:auto; display:block;">
                  </a>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span class="kicker">{{t.offer}}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Main card -->
      <table role="presentation" class="container card" cellpadding="0" cellspacing="0">
        <!-- Hero with rounded corners -->
        <tr>
          <td class="card-hero">
            <img src="{{image_1}}" width="600" alt="{{EMAIL_HEADLINE}}">
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td class="card-body">
            <div class="badge">{{t.in_stock}} · {{t.delivered_by}} <span style="font-weight:bold;">{{t.delivery_time}}</span> · {{t.pay_on_delivery}}</div>
            <h1 class="h1 mt-14">{{EMAIL_HEADLINE}}</h1>
            <div class="lead">{{product_description}}</div>
            <!-- CTA stripe -->
            <table role="presentation" width="100%" class="cta-strip mt-18">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <div class="h2" style="font-size:22px; margin:0;">{{price}}</div>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <a class="btn" href="{{cta_url}}" target="_blank">{{t.add_to_cart}}</a>
                </td>
              </tr>
            </table>
            <!-- Side-by-side gallery -->
            <table role="presentation" width="100%" class="image-pair mt-20" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  <a href="{{cta_url}}" target="_blank" class="image-card">
                    <img src="{{image_2}}" alt="Lifestyle 1" width="280">
                  </a>
                </td>
                <td align="center">
                  <a href="{{cta_url}}" target="_blank" class="image-card">
                    <img src="{{image_3}}" alt="Lifestyle 2" width="280">
                  </a>
                </td>
              </tr>
            </table>
            <!-- Trust row -->
            <table role="presentation" width="100%" class="trust mt-18">
              <tr>
                <td><strong>{{t.fast_tracked_delivery}}</strong><br>{{t.in_stock_shipped_immediately}}</td>
                <td><strong>{{t.pay_on_delivery}}</strong><br>{{t.pay_on_delivery_methods}}</td>
                <td><strong>{{t.returns_14}}</strong><br>{{t.easy_returns}}</td>
                <td><strong>{{t.local_warehouse}}</strong><br>{{t.no_customs}}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Footer -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section center small" style="border-top:1px solid #eee;">
            {{t.sent_to}} {subtag:email}. <a href="{modify}{/modify}" target="_blank">{{t.edit_profile}}</a> ·
            <a href="{unsubscribe}{/unsubscribe}" target="_blank">{{t.unsubscribe}}</a> ·
            <a href="{{cta_url}}" target="_blank">{{t.store}}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  css: `/* ===== Reset / Base ===== */
body { margin:0; padding:0; background:#f6f6f6; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:0; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
/* Fix for emoji images in lists */
li img { display: inline-block !important; vertical-align: middle !important; }
a { color:#19A981; text-decoration:none; }
/* ===== Layout ===== */
.wrapper { width:100%; background:#f6f6f6; }
.container { width:100%; max-width:600px; margin:0 auto; background:#ffffff; }
.section { padding:20px; }
.center { text-align:center; }
.right { text-align:right; }
/* ===== Utility bar ===== */
.utility { background:#ffffff; }
.utility td { vertical-align:middle; }
/* ===== Card ===== */
.card { border:1px solid #eaeaea; border-radius:14px; background:#ffffff; box-shadow:0 2px 10px rgba(0,0,0,0.05); overflow:hidden; }
.card-hero img { width:100%; height:auto; display:block; }
.card-body { padding:20px; }
/* ===== Typography ===== */
.h1 { font-family:Arial, Helvetica, sans-serif; font-size:26px; line-height:1.3; color:#111; margin:0 0 8px 0; }
.h2 { font-family:Arial, Helvetica, sans-serif; font-size:20px; line-height:1.35; color:#111; margin:0 0 10px 0; }
.lead { font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#444; margin:0; }
.small { font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.5; color:#888; }
/* ===== Visual elements ===== */
.badge { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#0a0a0a; background:#E9F8F3; border:1px solid #CBEFE3; padding:6px 10px; border-radius:18px; display:inline-block; }
.kicker { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#64748b; letter-spacing:0.08em; text-transform:uppercase; }
/* ===== Buttons ===== */
.btn { font-family:Arial, Helvetica, sans-serif; display:inline-block; background:#19A981; color:#fff !important; padding:14px 24px; border-radius:6px; font-weight:bold; font-size:16px; }
.btn-ghost { display:inline-block; border:2px solid #19A981; color:#19A981 !important; padding:12px 20px; border-radius:6px; font-weight:bold; }
/* ===== Benefits (2 columns) ===== */
.benefits { width:100%; }
.benefits td { vertical-align:top; padding:6px 10px; }
.benefit-icon { width:26px; font-size:18px; }
.benefit-text { font-family:Arial, Helvetica, sans-serif; font-size:15px; color:#333; }
.benefit-col { width:50%; }
/* ===== CTA stripe ===== */
.cta-strip { background:#F4FBF9; border:1px solid #DFF3EC; border-radius:10px; padding:16px; }
/* ===== Side-by-side gallery ===== */
.image-pair { width:100%; }
.image-pair td { width:50%; padding:6px; }
.image-card { border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); display:block; }
.image-card img { width:100% !important; height:auto !important; display:block; border-radius:12px; }
/* ===== Trust row ===== */
.trust td { padding:10px; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#666; border-right:1px solid #eee; text-align:center; }
.trust td:last-child { border-right:0; }
/* ===== Spacing helpers ===== */
.mt-6 { margin-top:6px; }
.mt-10 { margin-top:10px; }
.mt-14 { margin-top:14px; }
.mt-18 { margin-top:18px; }
.mt-20 { margin-top:20px; }
/* ===== Responsive ===== */
@media only screen and (max-width:600px){
  .section { padding:16px !important; }
  .btn, .btn-ghost { width:100% !important; text-align:center !important; box-sizing: border-box !important; }
  .benefit-col { width:100% !important; display:block !important; }
  .benefits td { padding:6px 0 !important; }
  .cta-strip td { display:block !important; width:100% !important; text-align:center !important; }
  .cta-strip td:first-child { margin-bottom: 12px; }
  .trust td { display:block; border-right:0; border-bottom:1px solid #eee; }
  .trust tr td:last-child { border-bottom:0; }
}`
};

const TITLE_FIRST_TEMPLATE = {
  id: "tpl_title_first_duo_v1",
  name: "Title-First Duo Image",
  requiredImages: 3,
  html: `<!-- Preheader (hidden) -->
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
  {{brand_name}} – {{product_description_text}}
</div>
<table role="presentation" class="mail-wrap" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f2f4f7">
  <tr>
    <td align="center">
      <!-- Top utility -->
      <table role="presentation" class="shell title-stripe" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad" style="padding-top:12px; padding-bottom:12px;">
            <table role="presentation" width="100%">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <a href="{{cta_url}}" target="_blank"><img src="{{brand_logo_url}}" width="140" alt="{{brand_name}}" style="height:auto; display:block;"></a>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span class="kicker">{{t.offer}}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Title first -->
      <table role="presentation" class="shell" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad center">
            <h1 class="h1">{{EMAIL_HEADLINE}}</h1>
          </td>
        </tr>
      </table>
      <!-- Two images side by side -->
      <table role="presentation" class="shell duo" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="{{cta_url}}" target="_blank" class="duo-card">
              <img src="{{image_1}}" width="280" alt="Lifestyle 1">
            </a>
          </td>
          <td align="center">
            <a href="{{cta_url}}" target="_blank" class="duo-card">
              <img src="{{image_2}}" width="280" alt="Lifestyle 2">
            </a>
          </td>
        </tr>
      </table>
      <!-- Description with bullets -->
      <table role="presentation" class="shell" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad">
            <div class="lead">{{product_description}}</div>
          </td>
        </tr>
      </table>
      <!-- CTA with soft shadow -->
      <table role="presentation" class="shell" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad center">
            <table role="presentation" align="center" class="cta-wrap">
              <tr>
                <td class="center" style="padding:8px 12px;">
                  <div class="price">{{price}}</div>
                  <div class="small" style="margin-top:6px;">{{t.savings_info}}</div>
                  <div style="height:14px;"></div>
                  <a href="{{cta_url}}" target="_blank" class="btn-cta">{{t.add_to_cart}}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Final big image -->
      <table role="presentation" class="shell banner" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad">
            <img src="{{image_3}}" width="600" alt="Product hero">
          </td>
        </tr>
      </table>
      <!-- (Optional) Trust row -->
      <table role="presentation" class="shell" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad">
            <table role="presentation" width="100%" class="trust">
              <tr>
                <td><strong>{{t.fast_tracked_delivery}}</strong><br>{{t.in_stock_shipped_immediately}}</td>
                <td><strong>{{t.pay_on_delivery}}</strong><br>{{t.pay_on_delivery_methods}}</td>
                <td><strong>{{t.returns_14}}</strong><br>{{t.easy_returns}}</td>
                <td><strong>{{t.local_warehouse}}</strong><br>{{t.no_customs}}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Footer -->
      <table role="presentation" class="shell" cellpadding="0" cellspacing="0">
        <tr>
          <td class="pad center small" style="border-top:1px solid #e5e7eb;">
            {{t.sent_to}} {subtag:email}. <a href="{modify}{/modify}" target="_blank">{{t.edit_profile}}</a> ·
            <a href="{unsubscribe}{/unsubscribe}" target="_blank">{{t.unsubscribe}}</a> ·
            <a href="{{cta_url}}" target="_blank">{{t.store}}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  css: `/* ===== Reset / Base ===== */
body { margin:0; padding:0; background:#f2f4f7; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:0; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
/* Fix for emoji images in lists */
li img { display: inline-block !important; vertical-align: middle !important; }
a { color:#116b5a; text-decoration:none; }
/* ===== Layout ===== */
.mail-wrap { width:100%; background:#f2f4f7; }
.shell { width:100%; max-width:600px; margin:0 auto; background:#ffffff; }
.pad { padding:20px; }
.center { text-align:center; }
.right { text-align:right; }
/* ===== Headings & Text ===== */
.h1 { font-family: Arial, Helvetica, sans-serif; font-size:28px; line-height:1.25; color:#0f172a; margin:0; }
.lead { font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#475569; margin:0; }
.small { font-family: Arial, Helvetica, sans-serif; font-size:12px; line-height:1.5; color:#94a3b8; }
/* ===== Title stripe ===== */
.title-stripe { background:#ffffff; border-bottom:1px solid #e5e7eb; }
.kicker { font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#64748b; letter-spacing:0.08em; text-transform:uppercase; }
/* ===== Duo images (side-by-side) ===== */
.duo { width:100%; background:#f8fafc; border-top:1px solid #eef2f7; border-bottom:1px solid #eef2f7; }
.duo td { width:50%; padding:10px; }
.duo-card { border-radius:14px; overflow:hidden; box-shadow:0 2px 10px rgba(15,23,42,0.06); display:block; background:#fff; }
.duo-card img { width:100% !important; height:auto !important; display:block; }
/* ===== Bulleted description ===== */
.points { width:100%; }
.points td { vertical-align:top; padding:6px 0; }
.tick { width:24px; font-size:16px; }
.point { font-family: Arial, Helvetica, sans-serif; font-size:15px; color:#334155; }
/* ===== CTA block ===== */
.cta-wrap { padding:22px; background:#f7fffb; border:1px solid #e2f2ec; border-radius:14px; }
.price { font-family: Arial, Helvetica, sans-serif; font-size:22px; color:#0f172a; font-weight:bold; }
.btn-cta {
  font-family: Arial, Helvetica, sans-serif;
  display:inline-block;
  padding:14px 28px;
  background:#19A981;
  color:#ffffff !important;
  border-radius:999px;
  font-weight:bold;
  font-size:16px;
  box-shadow: 0 8px 18px rgba(25,169,129,0.28), 0 2px 6px rgba(2,6,23,0.08);
}
/* ===== Final banner image ===== */
.banner img { width:100% !important; max-width:600px !important; height:auto !important; border-radius:12px; box-shadow:0 2px 10px rgba(15,23,42,0.06); }
/* ===== Trust row (optional) ===== */
.trust td { padding:10px; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#64748b; border-right:1px solid #e5e7eb; text-align:center; }
.trust td:last-child { border-right:0; }
/* ===== Responsive ===== */
@media only screen and (max-width:600px){
  .pad { padding:16px !important; }
  .btn-cta { width:100% !important; text-align:center !important; box-sizing: border-box !important; }
  .trust td { display:block; border-right:0; border-bottom:1px solid #e5e7eb; }
  .trust tr td:last-child { border-bottom:0; }
}`
};

const RIBBON_HERO_TEMPLATE = {
  id: "tpl_ribbon_hero_v1",
  name: "Ribbon Hero",
  requiredImages: 3,
  html: `<!-- Preheader (hidden) -->
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
  {{brand_name}} – {{product_description_text}}
</div>
<table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f5f7">
  <tr>
    <td align="center">
      <!-- Utility bar -->
      <table role="presentation" class="container utility" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section" style="padding-top:12px; padding-bottom:12px;">
            <table role="presentation" width="100%">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <a href="{{cta_url}}" target="_blank">
                    <img src="{{brand_logo_url}}" width="140" alt="{{brand_name}}" style="height:auto; display:block;">
                  </a>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span class="kicker">{{t.offer}}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Ribbon title -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="ribbon">
            {{EMAIL_HEADLINE}}
          </td>
        </tr>
      </table>
      <!-- Hero image -->
      <table role="presentation" class="container hero" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <a href="{{cta_url}}" target="_blank"><img src="{{image_1}}" width="600" alt="{{EMAIL_HEADLINE}}"></a>
          </td>
        </tr>
      </table>
      <!-- Intro -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section center">
            <div class="badge">{{t.in_stock}} · {{t.pay_on_delivery}}</div>
            <div class="lead" style="margin-top:12px;">{{product_description}}</div>
          </td>
        </tr>
      </table>
      <!-- Two images side-by-side -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section">
            <table role="presentation" width="100%" class="duo" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  <a href="{{cta_url}}" target="_blank">
                    <img src="{{image_2}}" width="280" alt="Lifestyle 1">
                  </a>
                </td>
                <td align="center">
                  <a href="{{cta_url}}" target="_blank">
                    <img src="{{image_3}}" width="280" alt="Lifestyle 2">
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- CTA -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section center">
              <div class="price-display">{{price}}</div>
              <a href="{{cta_url}}" target="_blank" class="btn">{{t.add_to_cart}}</a>
          </td>
        </tr>
      </table>
      <!-- Trust row -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section">
            <table role="presentation" width="100%" class="trust">
              <tr>
                <td><strong>{{t.fast_tracked_delivery}}</strong><br>{{t.post_and_days}}</td>
                <td><strong>{{t.pay_on_delivery}}</strong><br>{{t.pay_on_delivery_methods}}</td>
                <td><strong>{{t.returns_14}}</strong><br>{{t.easy_returns}}</td>
                <td><strong>{{t.local_warehouse}}</strong><br>{{t.no_customs}}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- Footer -->
      <table role="presentation" class="container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="section center small" style="border-top:1px solid #e5e7eb;">
            {{t.sent_to}} {subtag:email}. <a href="{modify}{/modify}" target="_blank">{{t.edit_profile}}</a> ·
            <a href="{unsubscribe}{/unsubscribe}" target="_blank">{{t.unsubscribe}}</a> ·
            <a href="{{cta_url}}" target="_blank">{{t.store}}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  css: `/* ===== Reset / Base ===== */
body { margin:0; padding:0; background:#f3f5f7; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:0; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
/* Fix for emoji images in lists */
li img { display: inline-block !important; vertical-align: middle !important; }
a { color:#19A981; text-decoration:none; }
/* ===== Layout ===== */
.wrapper { width:100%; background:#f3f5f7; }
.container { width:100%; max-width:600px; margin:0 auto; background:#ffffff; }
.section { padding:20px; }
.center { text-align:center; }
.right { text-align:right; }
/* ===== Top utility ===== */
.utility { background:#ffffff; border-bottom:1px solid #e6e9ec; }
.utility td { vertical-align:middle; }
/* ===== Ribbon Title ===== */
.ribbon {
  background: #19A981;
  color:#ffffff;
  text-align:center;
  font-family: Arial, Helvetica, sans-serif;
  font-size:20px;
  font-weight:bold;
  letter-spacing:0.3px;
  padding:14px 10px;
  border-top-left-radius:10px;
  border-top-right-radius:10px;
}
/* ===== Kicker (used in utility bar) ===== */
.kicker { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#64748b; letter-spacing:0.08em; text-transform:uppercase; }
/* ===== Typography ===== */
.h1 { font-family:Arial, Helvetica, sans-serif; font-size:26px; color:#0f172a; margin:0; line-height:1.35; }
.h2 { font-family:Arial, Helvetica, sans-serif; font-size:20px; color:#111827; margin:0 0 8px 0; line-height:1.4; }
.lead { font-family:Arial, Helvetica, sans-serif; font-size:15px; color:#475569; line-height:1.7; margin:0; }
.small { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#94a3b8; line-height:1.5; }
/* ===== Images ===== */
.hero img { width:100% !important; max-width:600px !important; height:auto !important; border-radius:0 0 12px 12px; box-shadow:0 6px 16px rgba(15,23,42,0.08); }
.duo td { width:50%; padding:8px; }
.duo img { width:100% !important; height:auto !important; border-radius:12px; box-shadow:0 4px 12px rgba(15,23,42,0.08); }
/* ===== Badges ===== */
.badge { font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#0b1512; background:#E9F8F3; border:1px solid #CBEFE3; padding:6px 10px; border-radius:18px; display:inline-block; }
/* ===== Price display & CTA ===== */
.price-display {
  font-family:Arial, Helvetica, sans-serif;
  font-size:28px;
  font-weight:bold;
  color:#111827;
  margin:0 0 12px 0;
}
.btn {
  font-family:Arial, Helvetica, sans-serif;
  display:inline-block;
  padding:14px 28px;
  background:#19A981;
  color:#fff !important;
  border-radius:999px;
  font-weight:bold;
  font-size:16px;
  box-shadow:0 8px 20px rgba(25, 169, 129, 0.28);
}
/* ===== Trust row ===== */
.trust td {
  padding:10px;
  font-family:Arial, Helvetica, sans-serif;
  font-size:12px;
  color:#64748b;
  border-right:1px solid #e5e7eb;
  text-align:center;
}
.trust td:last-child { border-right:0; }
/* ===== Responsive ===== */
@media only screen and (max-width:600px){
  .section { padding:16px !important; }
  .btn { width:100% !important; text-align:center !important; box-sizing: border-box !important; }
  .trust td { display:block; border-right:0; border-bottom:1px solid #e5e7eb; }
  .trust tr td:last-child { border-bottom:0; }
}`
};


// --- HELPER FUNCTIONS ---

// Credit: https://github.com/PimpTrizkit/PJs/wiki/12.-Shade,-Blend-and-Convert-a-Web-Color-(pSBC.js)
// FIX: The original pSBC function was not type-safe, used `this` in a way that would fail in this context, and had several logic bugs.
// It has been replaced with a rewritten, standalone, and safer TypeScript implementation to resolve all related errors.
const pSBC = (p: number, c0: string, c1?: string | boolean, l?: boolean): string | null => {
    let r: number, g: number, b: number, P: number, f: any, t: any, h: boolean, i = parseInt, m = Math.round;
    const a = typeof c1 === 'string';

    if (typeof p !== 'number' || p < -1 || p > 1 || typeof c0 !== 'string' || (c0.length > 0 && c0[0] !== 'r' && c0[0] !== '#') || (c1 && !a)) {
        return null;
    }

    const pSBCr = (d: string): { r: number, g: number, b: number, a: number } | null => {
        const i = parseInt;
        const m = Math.round;
        let n = d.length;
        let x: any = {};
        if (n > 9) {
            const parts = d.split(",");
            if (parts.length < 3 || parts.length > 4) return null;
            const r_part = parts[0];
            x.r = i(r_part.substring(r_part.indexOf("(") + 1));
            x.g = i(parts[1]);
            x.b = i(parts[2]);
            x.a = parts[3] ? parseFloat(parts[3]) : -1;
        } else {
            if (n === 8 || n === 6 || n < 4) return null;
            if (n < 6) d = "#" + d[1] + d[1] + d[2] + d[2] + d[3] + d[3] + (n > 4 ? d[4] + d[4] : "");
            const num = i(d.slice(1), 16);
            if (n === 9 || n === 5) {
                x.r = (num >> 24) & 255;
                x.g = (num >> 16) & 255;
                x.b = (num >> 8) & 255;
                x.a = m((num & 255) / 0.255) / 1000;
            } else {
                x.r = num >> 16;
                x.g = (num >> 8) & 255;
                x.b = num & 255;
                x.a = -1;
            }
        }
        return x;
    };

    h = c0.length > 9;
    h = a ? (c1 as string).length > 9 ? true : c1 === 'c' ? !h : false : h;
    f = pSBCr(c0);
    // FIX: The variable 'P' was incorrectly used as both a boolean and a number, which is invalid in TypeScript.
    // Introduced 'isNegative' to handle the boolean logic, allowing 'P' to be consistently treated as a number.
    const isNegative = p < 0;
    t = c1 && c1 !== 'c' ? pSBCr(c1 as string) : isNegative ? { r: 0, g: 0, b: 0, a: -1 } : { r: 255, g: 255, b: 255, a: -1 };
    let p_ = isNegative ? p * -1 : p;
    P = 1 - p_;

    if (!f || !t) return null;

    if (l) {
        r = m(P * f.r + p_ * t.r);
        g = m(P * f.g + p_ * t.g);
        b = m(P * f.b + p_ * t.b);
    } else {
        r = m(Math.pow(P * Math.pow(f.r, 2) + p_ * Math.pow(t.r, 2), 0.5));
        g = m(Math.pow(P * Math.pow(f.g, 2) + p_ * Math.pow(t.g, 2), 0.5));
        b = m(Math.pow(P * Math.pow(f.b, 2) + p_ * Math.pow(t.b, 2), 0.5));
    }

    let a_f = f.a;
    let t_a = t.a;
    let is_alpha = a_f >= 0 || t_a >= 0;
    let a_val = is_alpha ? (a_f < 0 ? t_a : t_a < 0 ? a_f : a_f * P + t_a * p_) : 0;

    if (h) {
        return "rgb" + (is_alpha ? "a(" : "(") + r + "," + g + "," + b + (is_alpha ? "," + m(a_val * 1000) / 1000 : "") + ")";
    } else {
        return "#" + (0x100000000 + r * 0x1000000 + g * 0x10000 + b * 0x100 + (is_alpha ? m(a_val * 255) : 0)).toString(16).slice(1, is_alpha ? undefined : -2);
    }
}

const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};


const PLACEHOLDER_IMAGE_URL = 'https://www.slike.maneks.eu/wp-content/uploads/2025/10/placeholder-image.jpg';

const simpleMarkdown = (text = '', bulletStyle = 'dot', colors: Record<string, string> = {}) => {
    if (!text) return '';
    const blocks: { type: 'paragraph' | 'list' | null; lines: string[] }[] = [];
    let currentBlock: { type: 'paragraph' | 'list' | null; lines: string[] } = { type: null, lines: [] };

    text.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        // Use a flag to allow processing of empty lines after a block has started
        if (!trimmedLine && currentBlock.type === null) return; 

        const isListItem = /^\s*[\*\-]\s*/.test(trimmedLine);
        const lineType = isListItem ? 'list' : 'paragraph';

        if (currentBlock.type !== lineType) {
            if (currentBlock.type) {
                blocks.push(currentBlock);
            }
            currentBlock = { type: lineType, lines: [trimmedLine] };
        } else {
            currentBlock.lines.push(trimmedLine);
        }
    });

    if (currentBlock.type) {
        blocks.push(currentBlock);
    }

    return blocks.map(block => {
        if (block.type === 'list') {
            const listStyle = bulletStyle === 'dot'
                ? `padding-left: 20px; margin: 1em 0; list-style-position: outside; text-align: left;`
                : `list-style-type: none; padding-left: 0; margin: 1em 0; text-align: left;`;

            const listItemsHtml = block.lines.map(line => {
                const content = line.replace(/^\s*[\*\-]\s*/, '').trim();
                let listItemContent;
                const color = colors.primary || '#19A981';

                switch (bulletStyle) {
                    case 'checkmark':
                        listItemContent = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody><tr><td valign="top" style="width: 20px; padding-right: 8px; font-family: Arial, sans-serif; font-size: 15px; color: ${color};">✓</td><td valign="top">${content}</td></tr></tbody></table>`;
                        break;
                    case 'arrow':
                        listItemContent = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody><tr><td valign="top" style="width: 20px; padding-right: 8px; font-family: Arial, sans-serif; font-size: 15px; color: ${color};">→</td><td valign="top">${content}</td></tr></tbody></table>`;
                        break;
                    case 'none':
                    case 'dot':
                    default:
                        listItemContent = content;
                        break;
                }
                const liStyle = (bulletStyle === 'checkmark' || bulletStyle === 'arrow')
                    ? `margin-bottom: 8px; padding-left: 0;`
                    : `margin-bottom: 8px; padding-left: 5px;`;

                return `<li style="${liStyle}">${listItemContent}</li>`;
            }).join('');

            return `<ul style="${listStyle}">${listItemsHtml}</ul>`;
        }
        if (block.type === 'paragraph') {
            const paragraphs = block.lines.map(line => `<p style="margin: 0 0 1em 0;">${line}</p>`).join('');
            return paragraphs;
        }
        return '';
    }).join('');
};


const renderEmail = (template, inputs, countryKey, isPreview = false) => {
    if (!template || !inputs || !countryKey) return { html: '', css: '', altBody: '' };

    const brand = BRANDS[inputs.brandKey];
    const market = MARKETS[countryKey];
    const i18n = I18N_STRINGS[countryKey] || {};
    const countryData = inputs.perCountryData[countryKey] || {};
    const translatedContent = inputs.generatedDescriptions[countryKey];
    const themeColor = inputs.themeColor || '#19A981';
    const bulletStyle = inputs.bulletStyle || 'dot';

    const price = countryData.price;
    let formattedPrice = '';
    if (price && market) {
        try {
            formattedPrice = new Intl.NumberFormat(market.locale, {
                style: 'currency',
                currency: market.currency,
            }).format(price);
        } catch (e) {
            console.error(e);
            formattedPrice = `${price} ${market.currency}`;
        }
    }
    
    let priceHtml = formattedPrice;
    if (inputs.isSpecialPrice && formattedPrice) {
        priceHtml = `
            <div style="line-height: 1.2;">
                <span style="display: inline-block; padding: 4px 10px; font-family: Arial, sans-serif; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; background-color: #facc15; border-radius: 999px; margin-bottom: 8px;">
                    ${i18n.amazing_price || 'AMAZING PRICE'}
                </span>
                <br>
                <span style="font-family: Arial, sans-serif; font-size: 32px; font-weight: 900; color: #111; line-height: 1;">
                    ${formattedPrice}
                </span>
            </div>
        `;
    }

    // --- Theme Color Application ---
    const ORIGINAL_COLORS = {
        primary: '#19A981',
        primary_dark: '#128a6a',
        primary_link_dark: '#116b5a',
        bg_badge: '#E9F8F3',
        border_badge: '#CBEFE3',
        bg_cta_strip: '#F4FBF9',
        border_cta_strip: '#DFF3EC',
        bg_cta_wrap: '#f7fffb',
        border_cta_wrap: '#e2f2ec',
        primary_rgb: '25, 169, 129',
    };

    const newPrimaryRgb = hexToRgb(themeColor);
    let newColors: typeof ORIGINAL_COLORS;

    if (newPrimaryRgb) {
        newColors = {
            primary: themeColor,
            primary_dark: pSBC(-0.15, themeColor) || ORIGINAL_COLORS.primary_dark,
            primary_link_dark: pSBC(-0.25, themeColor) || ORIGINAL_COLORS.primary_link_dark,
            bg_badge: pSBC(0.85, themeColor, '#ffffff') || ORIGINAL_COLORS.bg_badge,
            border_badge: pSBC(0.75, themeColor, '#ffffff') || ORIGINAL_COLORS.border_badge,
            bg_cta_strip: pSBC(0.90, themeColor, '#ffffff') || ORIGINAL_COLORS.bg_cta_strip,
            border_cta_strip: pSBC(0.80, themeColor, '#ffffff') || ORIGINAL_COLORS.border_cta_strip,
            bg_cta_wrap: pSBC(0.92, themeColor, '#ffffff') || ORIGINAL_COLORS.bg_cta_wrap,
            border_cta_wrap: pSBC(0.82, themeColor, '#ffffff') || ORIGINAL_COLORS.border_cta_wrap,
            primary_rgb: `${newPrimaryRgb.r}, ${newPrimaryRgb.g}, ${newPrimaryRgb.b}`,
        };
    } else {
        newColors = ORIGINAL_COLORS; // Fallback
    }

    let descriptionAsString = '';
    if (countryKey === 'en') {
        descriptionAsString = inputs.productDescription || '';
    }
    else if (translatedContent?.description) {
        const { intro, bullets } = translatedContent.description;
        descriptionAsString = `${intro || ''}\n\n${(bullets || []).map(b => `* ${b}`).join('\n')}`;
    }
    
    if (!descriptionAsString && inputs.productDescription) {
        descriptionAsString = inputs.productDescription;
    }
    
    const descriptionHtml = simpleMarkdown(descriptionAsString, bulletStyle, newColors);
    
    let preheaderText = translatedContent?.preheader || '';
    if (formattedPrice) {
        preheaderText = preheaderText.replace(/%price%/g, formattedPrice);
    }
    
    let emailSubject = translatedContent?.title || inputs.emailSubject;
    if (formattedPrice) {
        emailSubject = emailSubject.replace(/%price%/g, formattedPrice);
    }

    const headline = translatedContent?.headline || inputs.editableHeadline;

    const tokenMap = {
        'brand_name': brand.displayName,
        'brand_logo_url': brand.logoUrl,
        'product_description': descriptionHtml,
        'product_description_text': preheaderText,
        'price': priceHtml,
        'cta_url': countryData.productUrl || '',
        'EMAIL_HEADLINE': headline,
        'EMAIL_TITLE': emailSubject,
    };

    for(let i = 0; i < template.requiredImages; i++) {
        const imageUrl = inputs.images[i] || '';
        if (isPreview && !imageUrl) {
            tokenMap[`image_${i+1}`] = PLACEHOLDER_IMAGE_URL;
        } else {
            tokenMap[`image_${i+1}`] = imageUrl;
        }
    }

    Object.keys(i18n).forEach(key => {
        tokenMap[`t.${key}`] = i18n[key];
    });
    

    let themedHtml = template.html;
    let themedCss = template.css;
    
    // Replace RGB values first
    themedHtml = themedHtml.replaceAll(new RegExp(ORIGINAL_COLORS.primary_rgb, 'g'), newColors.primary_rgb);
    themedCss = themedCss.replaceAll(new RegExp(ORIGINAL_COLORS.primary_rgb, 'g'), newColors.primary_rgb);

    // Replace hex codes (case-insensitive)
    for (const key of Object.keys(ORIGINAL_COLORS)) {
        if (key !== 'primary_rgb' && newColors[key] && ORIGINAL_COLORS[key]) {
            themedHtml = themedHtml.replaceAll(new RegExp(ORIGINAL_COLORS[key], 'gi'), newColors[key]);
            themedCss = themedCss.replaceAll(new RegExp(ORIGINAL_COLORS[key], 'gi'), newColors[key]);
        }
    }

    const replacer = (text) => text.replace(/{{(.*?)}}/g, (match, token) => {
        const trimmedToken = token.trim();
        return tokenMap.hasOwnProperty(trimmedToken) ? tokenMap[trimmedToken] : match;
    });

    let finalHtml = replacer(themedHtml);
    let finalCss = themedCss; // CSS has no {{}} tokens

    // Testimonial Injection
    if (inputs.testimonial && inputs.testimonial[countryKey]) {
        const testimonialData = inputs.testimonial[countryKey];
        const { testimonialText, rating, satisfactionLine } = testimonialData;
        
        if (testimonialText && rating && satisfactionLine) {
            const ratingString = (i18n.avg_rating || 'Average customer rating: {rating}/5').replace('{rating}', rating);
            const ratingText = `${ratingString} <span style="color: #f59e0b;">&#9733;</span> ${satisfactionLine}`;
            
            const testimonialHtml = `<!-- Testimonial -->
<table role="presentation" class="container" cellpadding="0" cellspacing="0">
  <tr>
    <td class="section" style="padding-bottom: 0;">
      <table role="presentation" width="100%" cellpadding="24" cellspacing="0" style="background-color: #f8f9fa; border-radius: 12px; border-left: 5px solid #f97316; text-align: center; font-family: Arial, Helvetica, sans-serif;">
        <tr>
          <td>
            <div style="color: #f59e0b; font-size: 24px; letter-spacing: 2px; margin-bottom: 8px;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
            <div style="font-size: 13px; color: #64748b; margin-bottom: 16px;">${ratingText}</div>
            <div style="font-size: 16px; line-height: 1.6; color: #1e293b; font-style: italic;">"${testimonialText}"</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
            
            const injectionPoints = [
                '<!-- Trust row -->',
                '<!-- (Optional) Trust row -->',
            ];

            let injected = false;
            for (const point of injectionPoints) {
                if (finalHtml.includes(point)) {
                    finalHtml = finalHtml.replace(point, testimonialHtml + '\n' + point);
                    injected = true;
                    break;
                }
            }

            if (!injected) {
                finalHtml = finalHtml.replace('<!-- Footer -->', testimonialHtml + '\n<!-- Footer -->');
            }
        }
    }

    const descriptionAsText = descriptionAsString.replace(/<[^>]*>/g, ' ').replace(/[\*\-]/g, '').replace(/\s+/g, ' ').trim();
    const altBody = `${emailSubject}\n\n${descriptionAsText}\n\n${i18n.more_about_product}: ${countryData.productUrl || ''}`;

    return {
        html: finalHtml,
        css: finalCss,
        altBody,
    };
};

const isValidUrl = (string) => {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
};

const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
};

// --- UI COMPONENTS ---

type FormGroupProps = { label: string; children: React.ReactNode; error?: string; action?: React.ReactNode };
const FormGroup: React.FC<FormGroupProps> = ({ label, children, error, action }) => (
    <div className="form-group">
        <div className="form-group-label-row">
            <label>{label}</label>
            {action && <div className="form-group-action">{action}</div>}
        </div>
        {children}
        {error && <p className="error-message">{error}</p>}
    </div>
);

const SegmentedControl = ({ options, value, onChange }) => (
    <div className="segmented-control">
        {options.map(opt => (
            <button
                key={opt.value}
                className={value === opt.value ? 'active' : ''}
                onClick={() => onChange(opt.value)}
            >
                {opt.label}
            </button>
        ))}
    </div>
);

const ValidationSummary = ({ errors }: { errors: Record<string, string | undefined> }) => {
    const errorMessages = Object.values(errors).filter(Boolean);
    if (errorMessages.length === 0) return null;

    return (
        <div className="validation-summary">
            <p>Please fix the following issues:</p>
            <ul>
                {errorMessages.map((msg, i) => <li key={i}>{msg}</li>)}
            </ul>
        </div>
    );
};

type PreviewViewportProps = {
    label: string;
    device: 'desktop' | 'mobile';
    senderName: string;
    subject: string;
    preheader: string;
    html: string;
    css: string;
};

const PreviewViewport: React.FC<PreviewViewportProps> = ({ label, device, senderName, subject, preheader, html, css }) => (
    <div className="preview-viewport">
        <div className="preview-viewport-header">
            <h3>{label}</h3>
            <span className="device-chip">{device === 'desktop' ? 'Desktop' : 'Mobile'}</span>
        </div>
        <div className="inbox-preview-wrapper">
            <div className="inbox-preview">
                <div className="inbox-preview-avatar">{senderName.charAt(0)}</div>
                <div className="inbox-preview-content">
                    <div className="inbox-preview-sender">{senderName}</div>
                    <div className="inbox-preview-subject-line">
                        <span className="inbox-preview-subject">{subject}</span>
                        <span className="inbox-preview-separator"> - </span>
                        <span className="inbox-preview-preheader">{preheader}</span>
                    </div>
                </div>
                <div className="inbox-preview-timestamp">9:32 AM</div>
            </div>
        </div>
        <div className="preview-iframe-wrapper">
            <iframe
                className={`preview-iframe ${device}`}
                srcDoc={`<html><head><style>${css}</style></head><body>${html}</body></html>`}
                title={`Email Preview – ${label}`}
            />
        </div>
    </div>
);


const TemplateManagerModal = ({ isOpen, onClose, onSave }) => {
    const { runTask, pushToast } = useAsyncUI();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        if (!name || !description) {
            pushToast({ type: 'warning', message: 'Please provide a name and description before generating.' });
            return;
        }
        setIsGenerating(true);

        try {
            const schema = {
                type: "object",
                properties: {
                    html: {
                        type: "string",
                        description: "The full, responsive, table-based HTML for the email template, using the specified placeholders."
                    },
                    css: {
                        type: "string",
                        description: "The corresponding CSS for the email template, including media queries for responsiveness."
                    },
                    requiredImages: {
                        type: "integer",
                        description: "The number of unique product images required by the template, based on the user's description (from 1 to 3)."
                    }
                },
                required: ["html", "css", "requiredImages"]
            };

            const placeholders = `
- Main content placeholders:
  - {{brand_name}}: The name of the brand (e.g., "Netscroll").
  - {{brand_logo_url}}: URL for the brand's logo image.
  - {{cta_url}}: The primary call-to-action URL for the product or store. All links should use this.
  - {{EMAIL_HEADLINE}}: The main heading/title of the email body. This is the <h1> inside the email.
  - {{product_description}}: The main block of text describing the product. This can contain paragraphs and bullet points.
  - {{product_description_text}}: A plain-text version of the description for the preheader. The preheader should be a hidden div at the top of the body.
  - {{price}}: The formatted price of the product.
- Image placeholders: Use {{image_1}}, {{image_2}}, and {{image_3}} for up to 3 product/lifestyle images. The number of images used should match the 'requiredImages' output.
- Translation placeholders (use these for any localizable static text):
  - {{t.offer}}, {{t.in_stock}}, {{t.delivered_by}}, {{t.delivery_time}}, {{t.pay_on_delivery}}, {{t.add_to_cart}}, {{t.more_about_product}}, {{t.fast_tracked_delivery}}, {{t.in_stock_shipped_immediately}}, {{t.pay_on_delivery_methods}}, {{t.returns_14}}, {{t.easy_returns}}, {{t.local_warehouse}}, {{t.no_customs}}, {{t.sent_to}}, {{t.edit_profile}}, {{t.unsubscribe}}, {{t.store}}, {{t.savings_info}}.
- Footer placeholders:
  - {subtag:email}: The recipient's email address.
  - {modify}{/modify}: Link to modify user profile.
  - {unsubscribe}{/unsubscribe}: Unsubscribe link.
`;

            const prompt = `You are an expert email developer specializing in creating beautiful, responsive, and highly compatible HTML email templates. Your task is to generate a complete email template (HTML and CSS) based on a user's description.

The generated template MUST be compatible with a system that uses specific placeholders.

**User's Template Description:**
"${description}"

**Key Instructions & Constraints:**
1.  **HTML Structure:** Create a responsive, mobile-first design using table-based layouts for maximum email client compatibility (e.g., Gmail, Outlook, Apple Mail). Use standard HTML and avoid modern web tags that are poorly supported in emails.
2.  **CSS:** Provide a complete block of CSS. Include a reset, base styles, and media queries for responsiveness (e.g., @media only screen and (max-width:599px)). Use simple, well-supported CSS properties.
3.  **Placeholders:** You MUST use the exact placeholders provided below for all dynamic content. Do not invent new ones.
4.  **Images:** The user's description will imply how many images are needed. Your design should use that many images, named sequentially: {{image_1}}, {{image_2}}, etc. The maximum is 3. The 'requiredImages' value in your JSON output must match the number of image placeholders you use.
5.  **Preheader:** The email must include a hidden preheader div right after the opening <body> tag. It should look like this: <div style="display:none;...etc...">{{brand_name}} – {{product_description_text}}</div>.
6.  **Footer:** The email must include a standard footer with links for 'edit profile', 'unsubscribe', and the online store, using the provided placeholders.

**Available Placeholders:**
${placeholders}

Based on the user's description, generate a JSON object matching the required schema. The HTML and CSS should be clean, well-commented, and production-ready.`;


            const result = await runTask('Generating template layout…', () => runJsonPrompt({
                prompt,
                schema,
                schemaName: 'TemplateSchema',
                model: 'gpt-4.1',
            }), { suppressErrorToast: false });
            
            const requiredImages = Math.max(1, Math.min(3, Number(result.requiredImages) || 1));

            const newTemplate = {
                id: `tpl_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
                name,
                requiredImages: requiredImages,
                html: result.html,
                css: result.css
            };
            onSave(newTemplate);
            onClose();
            pushToast({ type: 'success', message: `"${name}" template added to your library.` });

        } catch (error) {
            console.error("Error generating template:", error);
        } finally {
            setIsGenerating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-backdrop">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>Create New Template with AI</h2>
                    <button onClick={onClose} className="close-button">&times;</button>
                </div>
                <div className="modal-body">
                    <FormGroup label="Template Name">
                        <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Minimalist Product Showcase" />
                    </FormGroup>
                    <FormGroup label="Describe your template">
                        <textarea 
                            className="form-textarea" 
                            value={description} 
                            onChange={e => setDescription(e.target.value)} 
                            placeholder="e.g., 'A clean template with a big hero image at the top, followed by a title and a short description. Below that, show two smaller images side-by-side. Finish with a prominent green call-to-action button.'"
                            style={{minHeight: '120px'}}
                        />
                    </FormGroup>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isGenerating}>Cancel</button>
                    <button className="btn" onClick={handleGenerate} disabled={isGenerating}>
                        {isGenerating ? 'Generating...' : '✨ Generate Template'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const SqualoMailUploadModal = ({ isOpen, onClose, brandKey, selectedCountryKeys, getRenderedEmailForCountry, generatedDescriptions, perCountryData, emailSubject: fallbackSubject }) => {
    const { runTask, pushToast } = useAsyncUI();
    const [apiKey, setApiKey] = useState('1d0e13ed4104476990a02b096140a393');
    const [listIdsByCountry, setListIdsByCountry] = useState({});
    const [addUtm, setAddUtm] = useState(true);
    const [utmSource, setUtmSource] = useState('newsletter');
    const [utmMedium, setUtmMedium] = useState('email');
    const [utmCampaign, setUtmCampaign] = useState('');
    const [newsletterNumber, setNewsletterNumber] = useState('');
    const [sku, setSku] = useState('');
    const [sendDate, setSendDate] = useState('');
    const [sendTime, setSendTime] = useState('');
    
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState({});

    // Effect to reset form state when the modal is opened
    useEffect(() => {
        if (isOpen) {
            const initialStatus = {};
            const initialListIds = {};
            selectedCountryKeys.forEach(key => {
                initialStatus[key] = { status: 'pending' };
                initialListIds[key] = DEFAULT_LIST_IDS[brandKey]?.[key] || '';
            });
            setUploadStatus(initialStatus);
            setListIdsByCountry(initialListIds);
            setIsUploading(false);
            setNewsletterNumber('');
            setSku('');

            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            setSendDate(`${year}-${month}-${day}`);
            setSendTime('09:00');
        }
    }, [isOpen, selectedCountryKeys, brandKey]);

    // Effect to dynamically update the UTM campaign based on newsletter number and SKU
    useEffect(() => {
        if (isOpen) {
            if (newsletterNumber && sku) {
                const campaignString = `${newsletterNumber}. Newsletter ${sku}`;
                const sanitizedCampaign = campaignString
                    .replace(/\./g, '') // remove dot
                    .replace(/\s+/g, '-') // replace spaces with hyphens
                    .toLowerCase();
                setUtmCampaign(sanitizedCampaign);
            } else {
                // Fallback to title-based default
                const firstCountry = selectedCountryKeys[0];
                if (firstCountry && generatedDescriptions[firstCountry]?.title) {
                    setUtmCampaign(generatedDescriptions[firstCountry].title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50));
                } else {
                    setUtmCampaign('newsletter-campaign');
                }
            }
        }
    }, [isOpen, newsletterNumber, sku, selectedCountryKeys, generatedDescriptions]);

    useEffect(() => {
        if (newsletterNumber) {
            setUtmSource(`newsletter-${newsletterNumber}`);
        } else {
            setUtmSource('newsletter');
        }
    }, [newsletterNumber]);

    const handleUpload = async () => {
        setIsUploading(true);
        try {
            await runTask('Uploading campaigns to SqualoMail…', async () => {
                const statuses = { ...uploadStatus };

                for (const countryKey of selectedCountryKeys) {
                    statuses[countryKey] = { status: 'uploading' };
                    setUploadStatus({ ...statuses });

                    try {
                        const { html: bodyHtml, css, altBody } = getRenderedEmailForCountry(countryKey);
                        const fullHtml = `<!DOCTYPE html><html><head><style>${css}</style></head><body>${bodyHtml}</body></html>`;
                        
                        const preheaderMatch = bodyHtml.match(/<div style="display:none[^>]*>([\s\S]*?)<\/div>/);
                        const rawPreheader = preheaderMatch ? preheaderMatch[1].trim().replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ') : altBody.substring(0, 150);
                        
                        const senderProfile = SENDER_PROFILES[brandKey]?.[countryKey];
                        if (!senderProfile) {
                            throw new Error(`Sender profile not found for ${brandKey} in ${countryKey}.`);
                        }
                        
                        const fromName = generatedDescriptions[countryKey]?.senderName || senderProfile.name;

                        const market = MARKETS[countryKey];
                        const countryData = perCountryData[countryKey] || {};
                        const price = countryData.price;
                        let formattedPrice = '';
                        if (price && market) {
                            try {
                                formattedPrice = new Intl.NumberFormat(market.locale, {
                                    style: 'currency',
                                    currency: market.currency,
                                }).format(price);
                            } catch (e) {
                                formattedPrice = `${price} ${market.currency}`;
                            }
                        }
                        
                        let subject = generatedDescriptions[countryKey]?.title || fallbackSubject;
                        if (formattedPrice) {
                            subject = subject.replace(/%price%/g, formattedPrice);
                        }

                        let preheader = rawPreheader;
                        if(formattedPrice) {
                            preheader = preheader.replace(/%price%/g, formattedPrice);
                        }
                        
                        const brandName = BRANDS[brandKey]?.displayName || brandKey;
                        const countryName = MARKETS[countryKey]?.displayName || countryKey;
                        let formattedDate = '';
                        if (sendDate) {
                            const dateParts = sendDate.split('-'); // YYYY-MM-DD
                            if (dateParts.length === 3) {
                               formattedDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
                            }
                        }
                        const campaignName = `${newsletterNumber}. newsletter (${sku}) ${formattedDate} ${countryName} ${brandName}`;

                        const countryListIdString = listIdsByCountry[countryKey] || '';

                        const payload: any = {
                            apiKey,
                            name: campaignName,
                            subject: subject,
                            preheader,
                            body: fullHtml,
                            altBody,
                            fromEmail: senderProfile.email,
                            fromName: fromName,
                            replyToEmail: senderProfile.email,
                            replyToName: senderProfile.name,
                            language: countryKey,
                            listIds: countryListIdString.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)),
                            visible: false,
                            addUtm,
                        };

                        if (addUtm) {
                            payload.utmSource = utmSource;
                            payload.utmMedium = utmMedium;
                            payload.utmCampaign = utmCampaign;
                        }

                        // Step 1: Create the newsletter
                        const createResponse = await fetch('/api/squalomail/create-newsletter', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                        });

                        if (!createResponse.ok) {
                            const errorResult = await createResponse.json();
                            throw new Error(`Creation failed: ${errorResult.message || `API Error: ${createResponse.status}`}`);
                        }
                        
                        const creationResult = await createResponse.json();
                        
                        // The actual API response nests the newsletter object. The ID is at `newsletter.id`.
                        const newsletterId = creationResult?.newsletter?.id;

                        if (!newsletterId) {
                            console.error("Creation response did not contain a recognizable newsletter ID:", creationResult);
                            throw new Error('Could not get newsletter ID from creation response.');
                        }

                        // Step 2: Schedule the newsletter if a date and time are provided
                        if (sendDate && sendTime) {
                            const scheduledDateTime = new Date(`${sendDate}T${sendTime}`);
                            const unixTimestamp = Math.floor(scheduledDateTime.getTime() / 1000);

                            const params = new URLSearchParams({
                                apiKey,
                                newsletterId: newsletterId.toString(),
                                sendDate: unixTimestamp.toString(),
                            });

                            const scheduleUrl = `/api/squalomail/send-newsletter?${params.toString()}`;

                            const scheduleResponse = await fetch(scheduleUrl, {
                                method: 'GET',
                            });

                            if (!scheduleResponse.ok) {
                                const errorResult = await scheduleResponse.json();
                                throw new Error(`Scheduling failed (send-newsletter): ${errorResult.message || `API Error: ${scheduleResponse.status}`}`);
                            }
                            
                            await scheduleResponse.json(); // Consume the response body
                        }
                        
                        statuses[countryKey] = { status: 'success' };

                    } catch (error: any) {
                        console.error(`Failed to upload for ${countryKey}:`, error.message);
                        statuses[countryKey] = { status: 'error', message: error.message };
                    }
                    setUploadStatus({ ...statuses });
                }

                const hasErrors = Object.values(statuses).some((s: any) => s.status === 'error');
                if (!hasErrors) {
                    pushToast({ type: 'success', message: 'All campaigns created successfully!' });
                    onClose();
                } else {
                    pushToast({ type: 'warning', message: 'Some campaigns failed to upload. Please review the status list.' });
                }
            }, { suppressErrorToast: true });
        } catch (error) {
            console.error('SqualoMail upload failed:', error);
            pushToast({ type: 'error', message: error?.message || 'Failed to upload campaigns.' });
        } finally {
            setIsUploading(false);
        }
    };
    
    if (!isOpen) return null;

    return (
        <div className="modal-backdrop">
            <div className="modal-content" style={{maxWidth: '700px'}}>
                <div className="modal-header">
                    <h2>Upload to SqualoMail</h2>
                    <button onClick={onClose} className="close-button">&times;</button>
                </div>
                <div className="modal-body">
                    <FormGroup label="SqualoMail API Key">
                        <input className="form-input" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                    </FormGroup>

                    <fieldset className="details-fieldset">
                        <legend>Campaign Details</legend>
                        <div className="details-grid">
                            <FormGroup label="Newsletter Number">
                                <input type="number" className="form-input" value={newsletterNumber} onChange={e => setNewsletterNumber(e.target.value)} placeholder="e.g. 477" />
                            </FormGroup>
                            <FormGroup label="SKU">
                                <input className="form-input" value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. E-MiniSantaHats" />
                            </FormGroup>
                        </div>
                    </fieldset>
                    
                    <fieldset className="details-fieldset">
                        <legend>Scheduling (Optional)</legend>
                         <div className="details-grid">
                            <FormGroup label="Sending Date">
                                <input type="date" className="form-input" value={sendDate} onChange={e => setSendDate(e.target.value)} />
                            </FormGroup>
                            <FormGroup label="Sending Time">
                                <input type="time" className="form-input" value={sendTime} onChange={e => setSendTime(e.target.value)} />
                            </FormGroup>
                        </div>
                    </fieldset>

                    <fieldset className="list-id-fieldset">
                        <legend>List IDs</legend>
                        <div className="list-id-grid">
                            {selectedCountryKeys.map(key => (
                                <FormGroup key={key} label={MARKETS[key].displayName}>
                                    <input
                                        className="form-input"
                                        value={listIdsByCountry[key] || ''}
                                        onChange={e => {
                                            const { value } = e.target;
                                            setListIdsByCountry(prev => ({
                                                ...prev,
                                                [key]: value
                                            }));
                                        }}
                                        placeholder="e.g. 13"
                                    />
                                </FormGroup>
                            ))}
                        </div>
                    </fieldset>
                     <fieldset className="utm-fieldset">
                        <legend>UTM Parameters</legend>
                        <div className="utm-toggle">
                             <input type="checkbox" id="utm-toggle-checkbox" checked={addUtm} onChange={e => setAddUtm(e.target.checked)} />
                             <label htmlFor="utm-toggle-checkbox">Add UTM parameters to links</label>
                        </div>
                        {addUtm && (
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem'}}>
                                 <FormGroup label="utm_source">
                                    <input className="form-input" value={utmSource} onChange={e => setUtmSource(e.target.value)} />
                                </FormGroup>
                                 <FormGroup label="utm_medium">
                                    {/* FIX: Corrected typo from setMedium to setUtmMedium */}
                                    <input className="form-input" value={utmMedium} onChange={e => setUtmMedium(e.target.value)} />
                                </FormGroup>
                                <FormGroup label="utm_campaign">
                                    <input className="form-input" value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} placeholder="auto-generated if empty" />
                                </FormGroup>
                            </div>
                        )}
                    </fieldset>
                    <div className="upload-summary">
                        <h3>Campaigns to be created ({selectedCountryKeys.length})</h3>
                        <ul>
                            {selectedCountryKeys.map(key => (
                                <li key={key}>
                                    <div>
                                        <strong>{MARKETS[key].displayName}</strong>
                                        <div style={{fontSize: '0.8rem', color: 'var(--text-color-light)'}}>{generatedDescriptions[key]?.title || '...'}</div>
                                    </div>
                                    <span className={`upload-status ${uploadStatus[key]?.status}`}>
                                        {uploadStatus[key]?.status}
                                        {uploadStatus[key]?.status === 'error' && (
                                            <div className="error-tooltip">
                                                &#9432;
                                                <span className="tooltip-text">{uploadStatus[key]?.message}</span>
                                            </div>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isUploading}>Cancel</button>
                    <button className="btn" onClick={handleUpload} disabled={isUploading}>
                        {isUploading ? 'Uploading...' : `Upload ${selectedCountryKeys.length} Campaigns`}
                    </button>
                </div>
            </div>
        </div>
    );
};

const CopyReviewPanel = ({ selectedCountryKeys, generatedDescriptions, onCopyChange, onTranslateField, isTranslating, isComplete }) => {
    const displayKeys = Array.from(new Set(['en', ...selectedCountryKeys]));
    
    return (
        <div className="copy-review-panel">
            {displayKeys.map(key => {
                const content = generatedDescriptions[key];
                const isEnglish = key === 'en';
                if (!content && !isEnglish) return <div key={key}>No content generated for {MARKETS[key]?.displayName}.</div>;
                
                const { senderName = '', title = '', preheader = '', headline = '', description = { intro: '', bullets: [] } } = content || {};

                const createTranslateButton = (fieldName, text) => (
                    isEnglish && (
                        <button 
                            className="btn btn-secondary" 
                            style={{ padding: '0.625rem 0.75rem', flexShrink: 0 }}
                            onClick={() => onTranslateField(fieldName, text)}
                            disabled={isTranslating[fieldName]}
                        >
                            {isTranslating[fieldName] ? '...' : (isComplete[fieldName] ? '✔' : 'Translate')}
                        </button>
                    )
                );

                return (
                    <div key={key} className="copy-review-country-card">
                        <h3>{isEnglish ? "English (Source)" : MARKETS[key]?.displayName}</h3>
                        <FormGroup label="Sender Name">
                            <div className="input-with-button">
                                <input 
                                    className="form-input" 
                                    value={senderName} 
                                    onChange={e => onCopyChange(key, 'senderName', e.target.value)} 
                                />
                                {createTranslateButton('senderName', senderName)}
                            </div>
                        </FormGroup>
                        <FormGroup label="Email Subject">
                             <div className="input-with-button">
                                <input 
                                    className="form-input" 
                                    value={title} 
                                    onChange={e => onCopyChange(key, 'title', e.target.value)} 
                                />
                                {createTranslateButton('title', title)}
                            </div>
                        </FormGroup>
                        <FormGroup label="Email Headline (H1)">
                            <div className="input-with-button">
                                <input 
                                    className="form-input" 
                                    value={headline} 
                                    onChange={e => onCopyChange(key, 'headline', e.target.value)} 
                                />
                                {createTranslateButton('headline', headline)}
                            </div>
                        </FormGroup>
                        <FormGroup label="Preheader">
                            <div className="input-with-button">
                                <textarea 
                                    className="form-textarea" 
                                    value={preheader} 
                                    onChange={e => onCopyChange(key, 'preheader', e.target.value)} 
                                    style={{minHeight: '80px'}}
                                />
                                {createTranslateButton('preheader', preheader)}
                            </div>
                        </FormGroup>
                        <FormGroup label="Intro Paragraph">
                            <div className="input-with-button">
                                 <textarea 
                                    className="form-textarea" 
                                    value={description.intro} 
                                    onChange={e => onCopyChange(key, 'intro', e.target.value)} 
                                    style={{minHeight: '100px'}}
                                />
                                {createTranslateButton('intro', description.intro)}
                            </div>
                        </FormGroup>
                        <FormGroup label="Bullet Points (one per line)">
                            <div className="input-with-button">
                                <textarea 
                                    className="form-textarea" 
                                    value={(description.bullets || []).join('\n')} 
                                    onChange={e => onCopyChange(key, 'bullets', e.target.value)}
                                    style={{minHeight: '120px'}}
                                />
                                {createTranslateButton('bullets', (description.bullets || []).join('\n'))}
                            </div>
                        </FormGroup>
                    </div>
                );
            })}
        </div>
    );
};


declare const JSZip: any;

const App = () => {
    const { runTask, pushToast } = useAsyncUI();
    // --- STATE ---
    const [brandKey, setBrandKey] = useState('netscroll');
    const [themeColor, setThemeColor] = useState('#19A981');
    const [isSpecialPrice, setIsSpecialPrice] = useState(false);
    const [selectedCountryKeys, setSelectedCountryKeys] = useState(['si']);
    const [productDescription, setProductDescription] = useState('Your amazing product description goes here. It\'s perfect for anyone who needs a high-quality solution.\n\n* First key benefit\n* Second great feature\n* Another amazing point');
    const [bulletStyle, setBulletStyle] = useState('dot');
    const [images, setImages] = useState(['', '', '']);
    const [perCountryData, setPerCountryData] = useState({});
    const [editableHeadline, setEditableHeadline] = useState('Your New Favorite Product Is Here!');
    const [testimonial, setTestimonial] = useState(null);
    const [copyStrategy, setCopyStrategy] = useState('content');
    const [editableSubject, setEditableSubject] = useState('');
    const [editablePreheader, setEditablePreheader] = useState('');
    const [customSenderName, setCustomSenderName] = useState('');
    const [isTranslatingSenderName, setIsTranslatingSenderName] = useState(false);
    const [senderNameTranslationComplete, setSenderNameTranslationComplete] = useState(false);
    const [isTranslatingSubject, setIsTranslatingSubject] = useState(false);
    const [subjectTranslationComplete, setSubjectTranslationComplete] = useState(false);
    const [isTranslatingPreheader, setIsTranslatingPreheader] = useState(false);
    const [preheaderTranslationComplete, setPreheaderTranslationComplete] = useState(false);
    const [isTranslatingReviewFields, setIsTranslatingReviewFields] = useState({
        senderName: false, title: false, headline: false, preheader: false, intro: false, bullets: false
    });
    const [reviewFieldsTranslationComplete, setReviewFieldsTranslationComplete] = useState({
        senderName: false, title: false, headline: false, preheader: false, intro: false, bullets: false
    });
    
    const [templates, setTemplates] = useLocalStorage('email-templates', [DEFAULT_TEMPLATE, CARD_TEMPLATE_DETAILED, TITLE_FIRST_TEMPLATE, RIBBON_HERO_TEMPLATE]);
    const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE.id);

    const [previewCountryKey, setPreviewCountryKey] = useState('si');
    const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
    const [previewLayout, setPreviewLayout] = useState<'single' | 'split'>('single');
    const [secondaryPreviewCountry, setSecondaryPreviewCountry] = useState('');
    const [secondaryPreviewDevice, setSecondaryPreviewDevice] = useState<'desktop' | 'mobile'>('mobile');
    const [errors, setErrors] = useState<Record<string, string | undefined>>({});
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSqualoMailModalOpen, setIsSqualoMailModalOpen] = useState(false);
    
    const [generatedDescriptions, setGeneratedDescriptions] = useState({});
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [isGeneratingTestimonial, setIsGeneratingTestimonial] = useState(false);
    const [contentViewTab, setContentViewTab] = useState('editor');
    
    const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId) || templates[0], [templates, templateId]);
    
    // --- EFFECTS ---
    useEffect(() => {
      const required = selectedTemplate.requiredImages || 0;
      if (images.length !== required) {
          setImages(Array(required).fill(''));
      }
    }, [selectedTemplate, images.length]);

    useEffect(() => {
        if (!selectedCountryKeys.includes(previewCountryKey)) {
            setPreviewCountryKey(selectedCountryKeys[0] || '');
        }
    }, [selectedCountryKeys, previewCountryKey]);

    useEffect(() => {
        if (!secondaryPreviewCountry || !selectedCountryKeys.includes(secondaryPreviewCountry)) {
            const fallback = selectedCountryKeys.find(key => key !== previewCountryKey) || selectedCountryKeys[0] || '';
            if (fallback !== secondaryPreviewCountry) {
                setSecondaryPreviewCountry(fallback || '');
            }
        }
    }, [selectedCountryKeys, secondaryPreviewCountry, previewCountryKey]);

    useEffect(() => {
        if (previewLayout === 'split' && selectedCountryKeys.length < 2) {
            setPreviewLayout('single');
        }
    }, [previewLayout, selectedCountryKeys.length]);

    useEffect(() => {
        const newErrors: Record<string, string | undefined> = {};
        if (!brandKey) newErrors.brand = "Brand is required.";
        if (selectedCountryKeys.length === 0) newErrors.countries = "At least one market must be selected.";
        if (!templateId) newErrors.template = "Template is required.";
        if (!productDescription.trim()) newErrors.description = "Product description is required.";
        if (!editableHeadline.trim()) newErrors.emailHeadline = "Email headline is required.";

        for(let i = 0; i < selectedTemplate.requiredImages; i++) {
            if (!images[i] || !isValidUrl(images[i])) {
                newErrors[`image_${i}`] = `A valid URL for Image ${i+1} is required.`;
            }
        }
        
        selectedCountryKeys.forEach(key => {
            const data = perCountryData[key] || {};
            if (!data.price || data.price <= 0) {
                newErrors[`price_${key}`] = `Price for ${MARKETS[key].displayName} is required.`;
            }
            if (!data.productUrl || !isValidUrl(data.productUrl)) {
                newErrors[`url_${key}`] = `A valid product URL for ${MARKETS[key].displayName} is required.`;
            }
        });
        
        if (errors.generation) newErrors.generation = errors.generation;

        setErrors(newErrors);
    }, [brandKey, selectedCountryKeys, templateId, productDescription, images, perCountryData, selectedTemplate, editableHeadline]);


    // --- HANDLERS ---
    const handleGenerateCopy = async () => {
        if (!productDescription.trim() || selectedCountryKeys.length === 0) {
            pushToast({ type: 'warning', message: 'Add a product description and select at least one market first.' });
            return;
        }
        setIsGenerating(true);
        setErrors(prev => ({ ...prev, generation: undefined }));

        try {
            const properties = {};
            const keysToGenerate = Array.from(new Set(['en', ...selectedCountryKeys]));

            keysToGenerate.forEach(key => {
                const marketName = key === 'en' ? 'English' : MARKETS[key].displayName;
                properties[key] = {
                    type: "object",
                    description: `Content for the ${marketName} market.`,
                    properties: {
                        preheader: {
                            type: "string",
                            description: `A short, enticing sentence (max 150 characters) for the email preheader, written for the ${marketName} market. This appears in the inbox preview.`
                        },
                        title: {
                            type: "string",
                            description: `A short, catchy, and engaging email subject line for the product, written for the ${marketName} market.`
                        },
                        headline: {
                            type: "string",
                            description: `The main headline (H1) for the email body, written for the ${marketName} market. This is the main title inside the email content.`
                        },
                        description: {
                            type: "object",
                            description: `A short, persuasive sales description with an intro paragraph and a list of key benefits. Written for the ${marketName} market.`,
                            properties: {
                                intro: {
                                    type: "string",
                                    description: `An engaging introductory sentence or short paragraph. No bullet points here.`
                                },
                                bullets: {
                                    type: "array",
                                    description: `A list of key features/benefits, each as a separate string. Include relevant emojis.`,
                                    items: {
                                        type: "string"
                                    }
                                }
                            },
                            required: ['intro', 'bullets']
                        }
                    },
                    required: ['preheader', 'title', 'headline', 'description']
                };
            });

            const schema = {
                type: "object",
                properties,
                required: keysToGenerate,
            };
            
            let focusInstruction = '';
            if (copyStrategy === 'price') {
                focusInstruction = `The preheader and subject MUST be price-focused and compelling.
- You MUST use the placeholder \`%price%\` where the product's price should be mentioned. For example: "Only %price% for a limited time!", "Get yours now for just %price%". Be creative and vary the phrasing.
- The generated **subject** and **preheader** must be **different from each other**. Both should highlight the promotional price, but they should not be identical.`;
            } else {
                focusInstruction = 'The preheader and subject MUST be content-focused. Highlight the product\'s key benefits and create intrigue to encourage an open. DO NOT mention price or discounts in the subject or preheader.';
            }


            const prompt = `You are an expert multilingual copywriter. Your task is to create high-converting email copy for a product based on the original description provided, which serves as a creative brief.

**Primary Focus for Subject & Preheader:**
${focusInstruction}

Original Product Description (Creative Brief):
"${productDescription}"

For each language specified in the output schema, write a brand new, culturally-aware, and persuasive sales copy. **Do not simply translate the English version.** Instead, act as a native speaker for each language and craft a subject and description that resonates with the local audience, using appropriate tone, style, and idioms.

**Capitalization Rule:** For all generated text (preheaders, subjects, intros, bullets), use standard sentence case. This means only the first letter of a sentence is capitalized, and proper nouns are capitalized as needed. For example, use "Božična magija na vaši mizi" instead of "Božična Magija na Vaši Mizi". Avoid using title case.

The copy for each language should include:
1.  A short, enticing email preheader (max 150 characters). This appears in the user's inbox preview and should convince them to open the email.
2.  A catchy and engaging email subject line.
3.  The main headline (H1) for inside the email body.
4.  A short, persuasive sales description, consisting of:
    - An engaging introductory paragraph.
    - A list of key features/benefits as bullet points, incorporating relevant emojis.

First, generate the rewritten, optimized copy in English under the 'en' key. Then, generate the unique, localized copy for all other requested languages from scratch.

Provide the final output as a single JSON object matching the required schema. Ensure the 'intro' and 'bullets' are separate fields within the description object for each language.`;

            const resultJson = await runTask('Generating multilingual copy…', () =>
                runJsonPrompt({
                    prompt,
                    schema,
                    schemaName: 'SalesCopySchema',
                })
            );
            setGeneratedDescriptions(resultJson);
            
            if (resultJson.en) {
                setEditableSubject(resultJson.en.title);
                setEditablePreheader(resultJson.en.preheader);
                setEditableHeadline(resultJson.en.headline);
                setCustomSenderName('');
                setSenderNameTranslationComplete(false);
                setSubjectTranslationComplete(false);
                setPreheaderTranslationComplete(false);
                const { intro, bullets } = resultJson.en.description;
                const newDescriptionString = `${intro}\n\n${bullets.map(b => `* ${b}`).join('\n')}`;
                setProductDescription(newDescriptionString);
            }
            setContentViewTab('review');
            pushToast({ type: 'success', message: 'Sales copy generated for all selected markets.' });

        } catch (error) {
            console.error("Error generating sales copy:", error);
            const errorMessage = "Failed to generate copy. The AI might have returned an unexpected format. Please try again.";
            setErrors(prev => ({ ...prev, generation: errorMessage }));
            pushToast({ type: 'error', message: error.message || errorMessage });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRefineCopy = async () => {
        if (Object.keys(generatedDescriptions).length === 0) {
            pushToast({ type: 'warning', message: 'Generate copy before running the proofreader.' });
            return;
        }
        setIsRefining(true);
        setErrors(prev => ({ ...prev, generation: undefined }));

        try {
            const refinedDescriptions = await runTask('Refining copy…', async () => {
                const updated = { ...generatedDescriptions };

                for (const langKey of Object.keys(generatedDescriptions)) {
                    const currentContent = generatedDescriptions[langKey];
                    const marketName = langKey === 'en' ? 'English' : MARKETS[langKey].displayName;
                    const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(langKey) || marketName;

                    const schema = {
                        type: "object",
                        properties: {
                            senderName: { type: "string", description: `The refined sender name.` },
                            preheader: { type: "string", description: `The refined, short, and enticing email preheader.` },
                            title: { type: "string", description: `The refined, catchy, and engaging email subject line.` },
                            headline: { type: "string", description: `The refined main headline for the email body.` },
                            description: {
                                type: "object",
                                properties: {
                                    intro: { type: "string", description: `The refined introductory sentence or short paragraph.` },
                                    bullets: { type: "array", items: { type: "string" }, description: `The list of refined key features/benefits.` }
                                },
                                required: ['intro', 'bullets']
                            }
                        },
                        required: ['preheader', 'title', 'headline', 'description', 'senderName']
                    };

                    const prompt = `You are an expert copywriter and a native ${languageName} speaker. Review the following email copy intended for the ${marketName} market.
                    Correct any grammatical errors, awkward phrasing, or stylistic issues.
                    Ensure the tone is persuasive, engaging, and sounds completely natural.
                    Do not change the core message or the benefits, but refine the language to make it perfect. Maintain the use of relevant emojis in the bullet points.

                    **Capitalization Rule:** Ensure all refined text follows standard sentence case. Capitalize only the first letter of each sentence and any proper nouns. For example, a subject should be "Božična magija na vaši mizi", not "Božična Magija na Vaši Mizi". Do not use title case.

                    Original Copy:
                    Sender Name: "${currentContent.senderName || ''}"
                    Preheader: "${currentContent.preheader}"
                    Subject: "${currentContent.title}"
                    Headline: "${currentContent.headline || ''}"
                    Intro: "${currentContent.description.intro}"
                    Bullets: ${JSON.stringify(currentContent.description.bullets)}

                    Return the refined copy in the exact same JSON format.`;

                    const refinedResult = await runJsonPrompt({
                        prompt,
                        schema,
                        schemaName: 'RefinedCopySchema',
                    });
                    updated[langKey] = refinedResult;
                }

                return updated;
            });

            setGeneratedDescriptions(refinedDescriptions);
            setSenderNameTranslationComplete(false);
            setSubjectTranslationComplete(false);
            setPreheaderTranslationComplete(false);

            if (refinedDescriptions.en) {
                setEditableSubject(refinedDescriptions.en.title);
                setEditablePreheader(refinedDescriptions.en.preheader);
                setEditableHeadline(refinedDescriptions.en.headline || '');
                setCustomSenderName(refinedDescriptions.en.senderName || '');
                const { intro, bullets } = refinedDescriptions.en.description;
                const newDescriptionString = `${intro}\n\n${bullets.map(b => `* ${b}`).join('\n')}`;
                setProductDescription(newDescriptionString);
            }
            setContentViewTab('review');
            pushToast({ type: 'success', message: 'Copy refined across all languages.' });

        } catch (error) {
            console.error("Error refining copy:", error);
            const errorMessage = "Failed to refine copy. The AI might have returned an unexpected format. Please try again.";
            setErrors(prev => ({ ...prev, generation: errorMessage }));
            pushToast({ type: 'error', message: error.message || errorMessage });
        } finally {
            setIsRefining(false);
        }
    };
    
    const handleTranslateSenderName = async () => {
        const targetLanguages = selectedCountryKeys.filter(k => k !== 'en');
        if (targetLanguages.length === 0 || !customSenderName) {
            setGeneratedDescriptions(prev => ({
                ...prev,
                en: { ...(prev.en || {}), senderName: customSenderName }
            }));
            setSenderNameTranslationComplete(true);
            return;
        }

        setIsTranslatingSenderName(true);

        try {
            const properties = {};
            targetLanguages.forEach(key => {
                properties[key] = {
                    type: "object",
                    properties: { senderName: { type: "string" } },
                    required: ['senderName']
                };
            });
            const schema = { type: "object", properties, required: targetLanguages };
            
            const languageNames = targetLanguages.map(key => MARKETS[key]?.displayName || key).join(', ');
            const prompt = `You are an expert translator. Translate the following English sender name into these languages: ${languageNames}. The output schema requires keys for these language codes: ${targetLanguages.join(', ')}. Ensure translations are natural and culturally appropriate. If the English sender name is an empty string, you MUST return an empty string for all languages.

English Sender Name: "${customSenderName}"

Provide the output as a single JSON object matching the schema.`;

            const translations = await runTask('Translating sender name…', () =>
                runJsonPrompt({
                    prompt,
                    schema,
                    schemaName: 'SenderTranslationSchema',
                })
            );

            setGeneratedDescriptions(prev => {
                const newDescriptions = { ...prev };
                if (newDescriptions.en) {
                    newDescriptions.en.senderName = customSenderName;
                } else {
                    newDescriptions.en = { senderName: customSenderName };
                }

                for (const langKey of targetLanguages) {
                    if (translations[langKey] && newDescriptions[langKey]) {
                        newDescriptions[langKey].senderName = translations[langKey].senderName;
                    }
                }
                return newDescriptions;
            });
            setSenderNameTranslationComplete(true);
            pushToast({ type: 'success', message: 'Sender name translated.' });

        } catch (error) {
            console.error("Error translating sender name:", error);
            pushToast({ type: 'error', message: error.message || 'Failed to translate the sender name. Please try again.' });
        } finally {
            setIsTranslatingSenderName(false);
        }
    };

    const handleTranslateField = async (fieldName: 'title' | 'preheader', text: string) => {
        const targetLanguages = selectedCountryKeys.filter(k => k !== 'en');
        const setTranslating = fieldName === 'title' ? setIsTranslatingSubject : setIsTranslatingPreheader;
        const setComplete = fieldName === 'title' ? setSubjectTranslationComplete : setPreheaderTranslationComplete;
    
        if (targetLanguages.length === 0 || !text.trim()) {
            setGeneratedDescriptions(prev => ({
                ...prev,
                en: { ...(prev.en || {}), [fieldName]: text }
            }));
            setComplete(true);
            return;
        }
    
        setTranslating(true);
    
        const fieldDisplayName = fieldName === 'title' ? 'Email Subject' : 'Email Preheader';

        try {
            const properties = {};
            targetLanguages.forEach(key => {
                properties[key] = {
                    type: "object",
                    properties: { [fieldName]: { type: "string" } },
                    required: [fieldName]
                };
            });
            const schema = { type: "object", properties, required: targetLanguages };
            
            const languageNames = targetLanguages.map(key => MARKETS[key]?.displayName || key).join(', ');
            const prompt = `You are an expert translator. Translate the following English ${fieldDisplayName} into these languages: ${languageNames}. The output schema requires keys for these language codes: ${targetLanguages.join(', ')}.
Ensure translations are natural and culturally appropriate.
IMPORTANT: You MUST preserve the \`%price%\` placeholder exactly as it is in the translated output if it exists.
**Capitalization Rule:** For all translations, use standard sentence case.

English ${fieldDisplayName}: "${text}"

Provide the output as a single JSON object matching the schema.`;
    
            const translations = await runTask(`Translating ${fieldDisplayName.toLowerCase()}…`, () =>
                runJsonPrompt({
                    prompt,
                    schema,
                    schemaName: 'FieldTranslationSchema',
                })
            );
    
            setGeneratedDescriptions(prev => {
                const newDescriptions = { ...prev };
                if (newDescriptions.en) {
                    newDescriptions.en[fieldName] = text;
                } else {
                    newDescriptions.en = { [fieldName]: text };
                }
    
                for (const langKey of targetLanguages) {
                    if (translations[langKey]) {
                        if (!newDescriptions[langKey]) newDescriptions[langKey] = {};
                        newDescriptions[langKey][fieldName] = translations[langKey][fieldName];
                    }
                }
                return newDescriptions;
            });
            setComplete(true);
            pushToast({ type: 'success', message: `${fieldDisplayName} translated.` });
    
        } catch (error) {
            console.error(`Error translating ${fieldName}:`, error);
            pushToast({ type: 'error', message: error.message || `Failed to translate the ${fieldDisplayName}. Please try again.` });
        } finally {
            setTranslating(false);
        }
    };

    const handleTranslateSubject = () => handleTranslateField('title', editableSubject);
    const handleTranslatePreheader = () => handleTranslateField('preheader', editablePreheader);

    const handleTranslateReviewField = async (fieldName, englishText) => {
        const targetLanguages = selectedCountryKeys.filter(k => k !== 'en');
        if (targetLanguages.length === 0 || !englishText.trim()) {
            return;
        }

        setIsTranslatingReviewFields(prev => ({ ...prev, [fieldName]: true }));
        const fieldDisplayNames = {
            senderName: 'Sender Name', title: 'Email Subject', headline: 'Email Headline',
            preheader: 'Email Preheader', intro: 'Intro Paragraph', bullets: 'Bullet Points'
        };
        const fieldDisplayName = fieldDisplayNames[fieldName] || 'text';
        const isBullets = fieldName === 'bullets';

        try {
            const properties = {};
            targetLanguages.forEach(key => {
                const fieldSchema = isBullets 
                    ? { type: "array", items: { type: "string" } }
                    : { type: "string" };

                properties[key] = {
                    type: "object",
                    properties: { [fieldName]: fieldSchema },
                    required: [fieldName]
                };
            });
            const schema = { type: "object", properties, required: targetLanguages };
            
            const languageNames = targetLanguages.map(key => MARKETS[key]?.displayName || key).join(', ');
            const prompt = `You are an expert translator. Translate the following English ${fieldDisplayName} into these languages: ${languageNames}. The output schema requires keys for these language codes: ${targetLanguages.join(', ')}.
Ensure translations are natural and culturally appropriate.
${isBullets ? 'Each line in the input is a separate bullet point. Your output for each language must be an array of translated strings, preserving any relevant emojis.' : ''}
IMPORTANT: If the source text contains the placeholder \`%price%\`, you MUST preserve it exactly as it is in the translated output.
**Capitalization Rule:** For all translations, use standard sentence case.

English ${fieldDisplayName}:
"${englishText}"

Provide the output as a single JSON object matching the schema.`;

            const translations = await runTask(`Translating ${fieldDisplayName.toLowerCase()}…`, () =>
                runJsonPrompt({
                    prompt,
                    schema,
                    schemaName: 'DescriptionTranslationSchema',
                })
            );

            setGeneratedDescriptions(prev => {
                const newDescriptions = JSON.parse(JSON.stringify(prev));

                for (const langKey of targetLanguages) {
                    if (translations[langKey] && translations[langKey][fieldName] !== undefined) {
                        if (!newDescriptions[langKey]) newDescriptions[langKey] = { description: {} };
                        
                        const translatedValue = translations[langKey][fieldName];
                        if (['intro', 'bullets'].includes(fieldName)) {
                            if (!newDescriptions[langKey].description) newDescriptions[langKey].description = {};
                            newDescriptions[langKey].description[fieldName] = translatedValue;
                        } else {
                            newDescriptions[langKey][fieldName] = translatedValue;
                        }
                    }
                }
                return newDescriptions;
            });
            setReviewFieldsTranslationComplete(prev => ({ ...prev, [fieldName]: true }));
            pushToast({ type: 'success', message: `${fieldDisplayName} translated.` });

        } catch (error) {
            console.error(`Error translating ${fieldName}:`, error);
            pushToast({ type: 'error', message: error.message || `Failed to translate the ${fieldDisplayName}. Please try again.` });
        } finally {
            setIsTranslatingReviewFields(prev => ({ ...prev, [fieldName]: false }));
        }
    };
    
    const handleGenerateTestimonial = async () => {
        if (!productDescription.trim() || selectedCountryKeys.length === 0) {
            pushToast({ type: 'warning', message: 'Describe the product and pick at least one market before generating testimonials.' });
            return;
        }
        setIsGeneratingTestimonial(true);
        setTestimonial(null); // Clear previous one

        try {
            const properties = {};
            const keysToGenerate = Array.from(new Set(['en', ...selectedCountryKeys]));

            keysToGenerate.forEach(key => {
                const marketName = key === 'en' ? 'English' : MARKETS[key].displayName;
                properties[key] = {
                    type: "object",
                    description: `Testimonial content for the ${marketName} market.`,
                    properties: {
                        testimonialText: {
                            type: "string",
                            description: `The testimonial text, 1-2 sentences, including <strong> tags to highlight a key benefit. Translated for ${marketName}.`
                        },
                        rating: {
                            type: "number",
                            description: 'A random rating score between 4.7 and 4.9 (e.g., 4.7, 4.8, or 4.9).'
                        },
                        satisfactionLine: {
                            type: "string",
                            description: `A complete, translated string like "| Over 582 happy pet owners!". The number should be random and over 500. The subject ('pet owners', 'families', 'customers') should match the product context. This entire string must be translated for ${marketName}.`
                        }
                    },
                    required: ['testimonialText', 'rating', 'satisfactionLine']
                };
            });
            
            const schema = {
                type: "object",
                properties,
                required: keysToGenerate,
            };

            const prompt = `You are an AI assistant creating realistic-sounding customer testimonials. Based on the product described below, generate a complete testimonial package.

Product Description:
"${productDescription}"

**Capitalization Rule:** All generated text, including the \`testimonialText\` and \`satisfactionLine\`, must use standard sentence case. Capitalize only the first letter of each sentence and any proper nouns. Avoid title case.

For each language, provide a JSON object with the following three fields:
1.  \`testimonialText\`: A short, positive, and genuine-sounding customer review from a relevant perspective (e.g., a parent for a family product, a pet owner for a pet product). It should be 1-2 sentences long and sound authentic. Use <strong> tags to highlight one or two key benefits.
2.  \`rating\`: A random rating score, as a number, between 4.7 and 4.9 (e.g., 4.7, 4.8, or 4.9).
3.  \`satisfactionLine\`: A complete, translated string like "| Over 582 happy pet owners!" or "| More than 610 satisfied customers!".
    - The number must be random and over 500.
    - The subject ('pet owners', 'families', 'customers') must be appropriate for the product context.
    - This entire string, including the pipe symbol, number, and subject, must be correctly translated for the target language.

First, generate the full package in English. Then, translate it for the specified markets. Provide the output as a JSON object matching the schema. The 'en' key must contain the English version.`;

            const resultJson = await runTask('Generating testimonials…', () =>
                runJsonPrompt({
                    prompt,
                    schema,
                    schemaName: 'TestimonialSchema',
                })
            );
            setTestimonial(resultJson);
            pushToast({ type: 'success', message: 'Testimonials generated for each market.' });

        } catch (error) {
            console.error("Error generating testimonial:", error);
            pushToast({ type: 'error', message: error.message || 'Failed to generate testimonial. Please try again.' });
        } finally {
            setIsGeneratingTestimonial(false);
        }
    };

    const handleMarketToggle = (key) => {
        setSelectedCountryKeys(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    const handlePerCountryChange = (key, field, value) => {
        setPerCountryData(prev => ({
            ...prev,
            [key]: {
                ...prev[key],
                [field]: field === 'price' ? Number(value) : value,
            }
        }));
    };

    const handleImageChange = (index, value) => {
        setImages(prev => {
            const newImages = [...prev];
            newImages[index] = value;
            return newImages;
        });
    };
    
    const handleSaveTemplate = (newTemplate) => {
        setTemplates(prev => [...prev, newTemplate]);
        setTemplateId(newTemplate.id);
    };

    const handleReviewCopyChange = (countryKey, field, value) => {
        // If English copy is being edited, update the individual state hooks as well
        if (countryKey === 'en') {
            if (field === 'title') setEditableSubject(value);
            if (field === 'preheader') setEditablePreheader(value);
            if (field === 'headline') setEditableHeadline(value);
            if (field === 'senderName') setCustomSenderName(value);
            setReviewFieldsTranslationComplete(prev => ({ ...prev, [field]: false }));
        }
    
        setGeneratedDescriptions(prev => {
            const newDescriptions = JSON.parse(JSON.stringify(prev));
            const countryData = newDescriptions[countryKey] || { description: {} };
            if (!newDescriptions[countryKey]) newDescriptions[countryKey] = countryData;

            if (field === 'intro') {
                if (!countryData.description) countryData.description = {};
                countryData.description.intro = value;
            } else if (field === 'bullets') {
                 if (!countryData.description) countryData.description = {};
                countryData.description.bullets = value.split('\n');
            } else {
                countryData[field] = value;
            }
            return newDescriptions;
        });
    };

    const handleInsertSampleData = () => {
        setBrandKey(SAMPLE_DATA.brandKey);
        setThemeColor(SAMPLE_DATA.themeColor);
        setIsSpecialPrice(SAMPLE_DATA.isSpecialPrice);
        setEditableHeadline(SAMPLE_DATA.headline);
        setProductDescription(SAMPLE_DATA.description);
        setSelectedCountryKeys(SAMPLE_DATA.markets);
        const clonedMarketData = typeof globalThis.structuredClone === 'function'
            ? globalThis.structuredClone(SAMPLE_DATA.perCountryData)
            : JSON.parse(JSON.stringify(SAMPLE_DATA.perCountryData));
        setPerCountryData(clonedMarketData);
        const requiredImages = selectedTemplate.requiredImages || SAMPLE_DATA.images.length;
        const paddedImages = Array.from({ length: requiredImages }, (_, idx) => SAMPLE_DATA.images[idx] || SAMPLE_DATA.images[0] || '');
        setImages(paddedImages);
        setEditableSubject('Wrap gifts like a pro for %price%');
        setEditablePreheader('Instantly tidy packages with the WrapMaster™ kit and bonus ribbons.');
        setPreviewCountryKey(SAMPLE_DATA.markets[0]);
        pushToast({ type: 'info', message: 'Loaded sample copy, images, and prices. Customize anything you like!' });
    };

    const isReadyForExport = Object.values(errors).filter(Boolean).length === 0;

    const getRenderedEmailForCountry = useCallback((countryKey, isPreview = false) => {
        return renderEmail(
            selectedTemplate,
            { brandKey, productDescription, images, perCountryData, editableHeadline, emailSubject: editableSubject, generatedDescriptions, testimonial, themeColor, bulletStyle, isSpecialPrice },
            countryKey,
            isPreview
        );
    }, [selectedTemplate, brandKey, productDescription, images, perCountryData, editableHeadline, editableSubject, generatedDescriptions, testimonial, themeColor, bulletStyle, isSpecialPrice]);

    const primaryPreviewDoc = useMemo(
        () => (previewCountryKey ? getRenderedEmailForCountry(previewCountryKey, true) : { html: '', css: '' }),
        [getRenderedEmailForCountry, previewCountryKey]
    );

    const secondaryPreviewDoc = useMemo(
        () => (secondaryPreviewCountry ? getRenderedEmailForCountry(secondaryPreviewCountry, true) : { html: '', css: '' }),
        [getRenderedEmailForCountry, secondaryPreviewCountry]
    );

    const getExportContent = useCallback(() => getRenderedEmailForCountry(previewCountryKey, false), [getRenderedEmailForCountry, previewCountryKey]);

    const buildInboxPreview = useCallback((countryKey: string) => {
        if (!countryKey) {
            return { senderName: 'Sender', subject: 'Subject Preview', preheader: 'Preheader preview…' };
        }

        const previewCountryContent = generatedDescriptions[countryKey];
        let subject = generatedDescriptions[countryKey]?.title || editableSubject || 'Email Subject Preview';
        let preheader = previewCountryContent?.preheader || editablePreheader || 'This is where the preheader text will appear...';

        const market = MARKETS[countryKey];
        const countryData = perCountryData[countryKey] || {};
        const price = countryData.price;
        if (price && market) {
            try {
                const formattedPrice = new Intl.NumberFormat(market.locale, {
                    style: 'currency',
                    currency: market.currency,
                }).format(price);
                subject = subject.replace(/%price%/g, formattedPrice);
                preheader = preheader.replace(/%price%/g, formattedPrice);
            } catch (e) {
                const fallbackPrice = `${price} ${market.currency}`;
                subject = subject.replace(/%price%/g, fallbackPrice);
                preheader = preheader.replace(/%price%/g, fallbackPrice);
            }
        }

        const senderProfile = SENDER_PROFILES[brandKey]?.[countryKey];
        const senderName = previewCountryContent?.senderName || senderProfile?.name || BRANDS[brandKey]?.displayName || 'Sender';

        return {
            senderName,
            subject,
            preheader,
        };
    }, [generatedDescriptions, editableSubject, editablePreheader, perCountryData, brandKey]);

    const primaryInboxPreview = useMemo(() => buildInboxPreview(previewCountryKey), [buildInboxPreview, previewCountryKey]);
    const secondaryInboxPreview = useMemo(() => buildInboxPreview(secondaryPreviewCountry), [buildInboxPreview, secondaryPreviewCountry]);

    const handleCopy = async (text: string, label = 'Content') => {
        try {
            await navigator.clipboard.writeText(text);
            pushToast({ type: 'success', message: `${label} copied to clipboard.` });
        } catch (err) {
            pushToast({ type: 'error', message: `Failed to copy ${label.toLowerCase()}.` });
        }
    };

    const handleCopyHtml = useCallback(() => {
        const { html: exportHtml } = getExportContent();
        handleCopy(exportHtml, 'HTML body');
    }, [getExportContent]);

    const handleCopyCss = useCallback(() => {
        const { css: exportCss } = getExportContent();
        handleCopy(exportCss, 'CSS styles');
    }, [getExportContent]);

    const handleDownloadFiles = useCallback(async () => {
        if (!isReadyForExport) return;

        const { html: exportHtml, css: exportCss } = getExportContent();
        
        const market = MARKETS[previewCountryKey];
        const countryData = perCountryData[previewCountryKey] || {};
        const price = countryData.price;
        let formattedPrice = '';
         if (price && market) {
            try {
                formattedPrice = new Intl.NumberFormat(market.locale, {
                    style: 'currency',
                    currency: market.currency,
                }).format(price);
            } catch (e) {
                formattedPrice = `${price} ${market.currency}`;
            }
        }
        
        let emailSubject = generatedDescriptions[previewCountryKey]?.title || editableSubject;
        if (formattedPrice) {
            emailSubject = emailSubject.replace(/%price%/g, formattedPrice);
        }

        const fullHtml = `<!DOCTYPE html>
<html lang="${MARKETS[previewCountryKey]?.locale?.split('-')[0] || 'en'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${emailSubject}</title>
    <style>
        ${exportCss}
    </style>
</head>
<body>
    ${exportHtml}
</body>
</html>`;

        try {
            const zip = new JSZip();
            zip.file("body.html", fullHtml);
            zip.file("stripo.html", fullHtml);
            zip.file("stripo.css", exportCss);

            const content = await zip.generateAsync({ type: "blob" });
            
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `squalomail-export-${previewCountryKey}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            pushToast({ type: 'success', message: 'ZIP package ready for download.' });
        } catch (error) {
            console.error("Error creating zip file:", error);
            pushToast({ type: 'error', message: 'Failed to create the ZIP file for download.' });
        }
    }, [getExportContent, isReadyForExport, previewCountryKey, editableSubject, generatedDescriptions, perCountryData]);

    const isSenderNameDirty = generatedDescriptions.en && customSenderName !== (generatedDescriptions.en.senderName || '');
    const isSubjectDirty = generatedDescriptions.en && editableSubject !== (generatedDescriptions.en.title || '');
    const isPreheaderDirty = generatedDescriptions.en && editablePreheader !== (generatedDescriptions.en.preheader || '');


    return (
        <>
            <header className="main-header">
                <span className="logo-icon">💌</span>
                <h1>Email Production Factory</h1>
            </header>
            <div className="app-container">
                <aside className="controls-panel">
                    <ValidationSummary errors={errors} />

                    <section className="control-section">
                        <h2>1. Project Setup</h2>
                        <FormGroup label="Brand">
                             <SegmentedControl
                                options={Object.values(BRANDS).map(b => ({ label: b.displayName, value: b.key }))}
                                value={brandKey}
                                onChange={setBrandKey}
                            />
                        </FormGroup>
                        <FormGroup label="Theme Color">
                            <div className="color-picker-wrapper">
                                <input 
                                    type="color" 
                                    className="form-color-input" 
                                    value={themeColor} 
                                    onChange={e => setThemeColor(e.target.value)}
                                />
                                <span className="color-picker-value">{themeColor}</span>
                            </div>
                        </FormGroup>
                         <FormGroup label="Price Style">
                            <label className="checkbox-label" style={{ justifyContent: 'flex-start', background: 'transparent', paddingLeft: 0 }}>
                                <input type="checkbox" checked={isSpecialPrice} onChange={(e) => setIsSpecialPrice(e.target.checked)} />
                                Enable Special Price Style
                            </label>
                        </FormGroup>
                        <FormGroup label="Markets">
                            <div className="market-grid">
                                {Object.values(MARKETS).map(m => (
                                    <label key={m.key} className="checkbox-label">
                                        <input type="checkbox" checked={selectedCountryKeys.includes(m.key)} onChange={() => handleMarketToggle(m.key)} />
                                        {m.displayName}
                                    </label>
                                ))}
                            </div>
                        </FormGroup>
                    </section>
                    
                    <section className="control-section">
                        <h2>2. Localization Data</h2>
                        {selectedCountryKeys.length > 0 ? (
                        <table className="per-country-table">
                            <thead>
                                <tr>
                                    <th>Country</th>
                                    <th>Price</th>
                                    <th>Product URL</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selectedCountryKeys.map(key => (
                                    <tr key={key}>
                                        <td>{MARKETS[key].displayName}</td>
                                        <td><input className="form-input" type="number" placeholder="e.g. 19.99" onChange={e => handlePerCountryChange(key, 'price', e.target.value)} /></td>
                                        <td><input className="form-input" type="text" placeholder="https://" onChange={e => handlePerCountryChange(key, 'productUrl', e.target.value)} /></td>
                                        <td>
                                            <span className={`status-icon ${(!errors[`price_${key}`] && !errors[`url_${key}`]) ? 'valid' : 'invalid'}`}>
                                               {(!errors[`price_${key}`] && !errors[`url_${key}`]) ? '✓' : '✕'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        ) : (
                            <p style={{color: 'var(--text-color-light)', fontSize: '0.875rem'}}>Select one or more markets to enter prices and links.</p>
                        )}
                    </section>

                     <section className="control-section">
                        <h2>3. Template & Content</h2>
                        <FormGroup label="Template">
                            <div style={{display: 'flex', gap: '0.5rem'}}>
                                <select className="form-select" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                <button className="btn btn-secondary" onClick={() => setIsModalOpen(true)}>+</button>
                            </div>
                        </FormGroup>
                         <FormGroup label="Email Headline">
                            <input className="form-input" value={editableHeadline} onChange={e => setEditableHeadline(e.target.value)} />
                        </FormGroup>
                         <FormGroup
                            label="Product Description"
                            error={errors.generation}
                            action={
                                <button type="button" className="btn-inline" onClick={handleInsertSampleData}>
                                    Insert Sample Data
                                </button>
                            }
                         >
                            {Object.keys(generatedDescriptions).length > 0 && (
                                <div className="content-view-tabs">
                                    <button className={contentViewTab === 'editor' ? 'active' : ''} onClick={() => setContentViewTab('editor')}>
                                        Editor
                                    </button>
                                    <button className={contentViewTab === 'review' ? 'active' : ''} onClick={() => setContentViewTab('review')}>
                                        Copy Review
                                    </button>
                                </div>
                            )}

                            {contentViewTab === 'editor' ? (
                                <>
                                    <textarea className="form-textarea" value={productDescription} onChange={e => setProductDescription(e.target.value)} />
                                    <div style={{ margin: '1rem 0' }}>
                                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
                                            Copywriting Strategy
                                        </label>
                                        <SegmentedControl
                                            options={[
                                                { label: 'Content & Sales', value: 'content' },
                                                { label: 'Price & Promotion', value: 'price' },
                                            ]}
                                            value={copyStrategy}
                                            onChange={setCopyStrategy}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <button
                                            className="btn btn-ai-generate"
                                            onClick={handleGenerateCopy}
                                            disabled={isGenerating || isRefining || !productDescription.trim()}
                                        >
                                            {isGenerating ? 'Generating...' : <>✨ Generate Sales Copy & Translate</>}
                                        </button>
                                        <button
                                            className="btn btn-ai-refine"
                                            onClick={handleRefineCopy}
                                            disabled={isGenerating || isRefining || Object.keys(generatedDescriptions).length === 0}
                                        >
                                            {isRefining ? 'Refining...' : <>✍️ Proofread & Refine Copy</>}
                                        </button>
                                    </div>
                                    {generatedDescriptions.en && (
                                        <div className="editable-copy-section">
                                            <h4>Edit English Copy</h4>
                                            <FormGroup label="Sender Name (Optional)">
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <input 
                                                        className="form-input" 
                                                        value={customSenderName} 
                                                        onChange={e => {
                                                            setCustomSenderName(e.target.value);
                                                            setSenderNameTranslationComplete(false);
                                                        }}
                                                        placeholder={BRANDS[brandKey]?.displayName}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <button 
                                                        className="btn btn-secondary" 
                                                        style={{ padding: '0.625rem 0.75rem', flexShrink: 0 }}
                                                        onClick={handleTranslateSenderName}
                                                        disabled={!isSenderNameDirty || isTranslatingSenderName}
                                                    >
                                                        {isTranslatingSenderName ? '...' : (senderNameTranslationComplete && !isSenderNameDirty ? '✔' : 'Translate')}
                                                    </button>
                                                </div>
                                            </FormGroup>
                                            <FormGroup label="Email Subject">
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <input
                                                        className="form-input"
                                                        value={editableSubject}
                                                        onChange={e => {
                                                            setEditableSubject(e.target.value);
                                                            setSubjectTranslationComplete(false);
                                                        }}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <button
                                                        className="btn btn-secondary"
                                                        style={{ padding: '0.625rem 0.75rem', flexShrink: 0 }}
                                                        onClick={handleTranslateSubject}
                                                        disabled={!isSubjectDirty || isTranslatingSubject}
                                                    >
                                                        {isTranslatingSubject ? '...' : (subjectTranslationComplete && !isSubjectDirty ? '✔' : 'Translate')}
                                                    </button>
                                                </div>
                                            </FormGroup>
                                            <FormGroup label="Email Preheader">
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                                    <textarea
                                                        className="form-textarea"
                                                        value={editablePreheader}
                                                        onChange={e => {
                                                            setEditablePreheader(e.target.value);
                                                            setPreheaderTranslationComplete(false);
                                                        }}
                                                        style={{ flex: 1, minHeight: '80px' }}
                                                    />
                                                    <button
                                                        className="btn btn-secondary"
                                                        style={{ padding: '0.625rem 0.75rem', flexShrink: 0 }}
                                                        onClick={handleTranslatePreheader}
                                                        disabled={!isPreheaderDirty || isTranslatingPreheader}
                                                    >
                                                        {isTranslatingPreheader ? '...' : (preheaderTranslationComplete && !isPreheaderDirty ? '✔' : 'Translate')}
                                                    </button>
                                                </div>
                                            </FormGroup>
                                            <p className="helper-text">Tip: Use <code>%price%</code> to include the country-specific price in your copy.</p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <CopyReviewPanel
                                    selectedCountryKeys={selectedCountryKeys}
                                    generatedDescriptions={generatedDescriptions}
                                    onCopyChange={handleReviewCopyChange}
                                    onTranslateField={handleTranslateReviewField}
                                    isTranslating={isTranslatingReviewFields}
                                    isComplete={reviewFieldsTranslationComplete}
                                />
                            )}
                        </FormGroup>
                         <FormGroup label="Bullet Point Style">
                            <SegmentedControl
                                options={[
                                    { label: '● Dot', value: 'dot' },
                                    { label: '✓ Check', value: 'checkmark' },
                                    { label: '→ Arrow', value: 'arrow' },
                                    { label: 'None', value: 'none' },
                                ]}
                                value={bulletStyle}
                                onChange={setBulletStyle}
                            />
                        </FormGroup>
                        {[...Array(selectedTemplate.requiredImages)].map((_, i) => (
                             <FormGroup key={i} label={`Image ${i+1} URL`}>
                                <input className="form-input" value={images[i] || ''} onChange={e => handleImageChange(i, e.target.value)} />
                             </FormGroup>
                        ))}
                         <FormGroup label="Customer Testimonial (Optional)">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleGenerateTestimonial}
                                    disabled={isGeneratingTestimonial || isGenerating || isRefining || !productDescription.trim()}
                                >
                                    {isGeneratingTestimonial ? 'Generating...' : '✨ Generate Testimonial'}
                                </button>
                                {testimonial && (
                                    <button
                                        className="btn btn-clear"
                                        onClick={() => setTestimonial(null)}
                                    >
                                        Clear Testimonial
                                    </button>
                                )}
                            </div>
                        </FormGroup>
                    </section>
                </aside>
                <main className="preview-panel">
                    <div className="preview-toolbar">
                        <div className="preview-toolbar-row">
                            <div className="preview-controls">
                                <div className="tabs">
                                    {selectedCountryKeys.map(key => (
                                        <button key={key} className={previewCountryKey === key ? 'active' : ''} onClick={() => setPreviewCountryKey(key)}>
                                            {MARKETS[key].displayName}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="preview-device-select">
                                <span>Device</span>
                                <SegmentedControl
                                    options={[{label: 'Desktop', value: 'desktop'}, {label: 'Mobile', value: 'mobile'}]}
                                    value={previewDevice}
                                    onChange={value => setPreviewDevice(value as 'desktop' | 'mobile')}
                                />
                            </div>
                            <div className="preview-layout-controls">
                                <span>Layout</span>
                                <div className="layout-buttons">
                                    <button
                                        type="button"
                                        className={previewLayout === 'single' ? 'active' : ''}
                                        onClick={() => setPreviewLayout('single')}
                                    >
                                        Single
                                    </button>
                                    <button
                                        type="button"
                                        className={previewLayout === 'split' ? 'active' : ''}
                                        onClick={() => setPreviewLayout('split')}
                                        disabled={selectedCountryKeys.length < 2}
                                        title={selectedCountryKeys.length < 2 ? 'Select at least two markets to compare' : 'Show two previews'}
                                    >
                                        Split view
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="export-actions">
                            <span className={`status-badge ${isReadyForExport ? 'ready' : 'error'}`}>
                                {isReadyForExport ? 'Ready to Export' : 'Errors found'}
                            </span>
                            <button className="btn btn-secondary" disabled={!isReadyForExport} onClick={handleCopyHtml}>Copy HTML</button>
                            <button className="btn btn-secondary" disabled={!isReadyForExport} onClick={handleCopyCss}>Copy CSS</button>
                            <button className="btn btn-secondary" disabled={!isReadyForExport} onClick={handleDownloadFiles}>Download Files</button>
                            <button className="btn" disabled={!isReadyForExport} onClick={() => setIsSqualoMailModalOpen(true)}>Upload to SqualoMail</button>
                        </div>
                    </div>
                    {previewLayout === 'split' && (
                        <div className="secondary-preview-controls">
                            <div>
                                <label>Compare Market</label>
                                <select className="form-select" value={secondaryPreviewCountry} onChange={e => setSecondaryPreviewCountry(e.target.value)}>
                                    {selectedCountryKeys.map(key => (
                                        <option key={key} value={key}>{MARKETS[key].displayName}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label>Compare Device</label>
                                <select className="form-select" value={secondaryPreviewDevice} onChange={e => setSecondaryPreviewDevice(e.target.value as 'desktop' | 'mobile')}>
                                    <option value="desktop">Desktop</option>
                                    <option value="mobile">Mobile</option>
                                </select>
                            </div>
                        </div>
                    )}
                    <div className={`preview-grid ${previewLayout === 'split' ? 'split' : ''}`}>
                        <PreviewViewport
                            label={MARKETS[previewCountryKey]?.displayName || 'Primary Preview'}
                            device={previewDevice}
                            senderName={primaryInboxPreview.senderName}
                            subject={primaryInboxPreview.subject}
                            preheader={primaryInboxPreview.preheader}
                            html={primaryPreviewDoc.html}
                            css={primaryPreviewDoc.css}
                        />
                        {previewLayout === 'split' && secondaryPreviewCountry && (
                            <PreviewViewport
                                label={MARKETS[secondaryPreviewCountry]?.displayName || 'Comparison'}
                                device={secondaryPreviewDevice}
                                senderName={secondaryInboxPreview.senderName}
                                subject={secondaryInboxPreview.subject}
                                preheader={secondaryInboxPreview.preheader}
                                html={secondaryPreviewDoc.html}
                                css={secondaryPreviewDoc.css}
                            />
                        )}
                    </div>
                </main>
                <TemplateManagerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveTemplate} />
                <SqualoMailUploadModal
                    isOpen={isSqualoMailModalOpen}
                    onClose={() => setIsSqualoMailModalOpen(false)}
                    brandKey={brandKey}
                    selectedCountryKeys={selectedCountryKeys}
                    getRenderedEmailForCountry={getRenderedEmailForCountry}
                    generatedDescriptions={generatedDescriptions}
                    perCountryData={perCountryData}
                    emailSubject={editableSubject}
                />
            </div>
        </>
    );
};

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
    <AsyncUIProvider>
        <App />
    </AsyncUIProvider>
);

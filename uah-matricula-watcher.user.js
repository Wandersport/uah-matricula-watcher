// ==UserScript==
// @name         UAH Cazador de Plazas v9 - SPA Retry
// @namespace    https://github.com/Wandersport/uah-matricula-watcher
// @version      9.0
// @description  Vigila plazas UAH con cuenta atrás y reinicio SPA sin recargar Firefox.
// @match        https://automatricula.uah.es/*
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /************************************************************
     * CONFIGURACIÓN
     ************************************************************/

    const REFRESH_MS = 60_000;

    const MAX_CONNECTIONS_RETRY_MS = 60_000;

    const NAVIGATION_POLL_MS = 800;

    const START_HASH =
        '#/acceso/bienvenida';

    const TARGETS = [
        {
            code: '000362011',
            name: 'ECONOMÍA REGIONAL'
        },
        {
            code: '000360027',
            name: 'ECONOMÍA AMBIENTAL'
        },
        {
            code: '000362016',
            name: 'PYTHON PARA ECONOMÍA Y EMPRESA'
        },
        {
            code: '000340093',
            name: 'CREACIÓN, CRECIMIENTO Y GESTIÓN DE PYMES'
        }
    ];

    const FULL_TEXT =
        'no es seleccionable porque no quedan plazas libres';

    const TAG =
        '[UAH WATCH]';


    /************************************************************
     * ESTADO
     ************************************************************/

    let busy = false;

    let stopped = false;

    let availabilityFound = false;

    let navigationInterval = null;

    let restartTimer = null;

    let countdownInterval = null;

    let lastAction = '';

    let lastActionTime = 0;

    let restartInProgress = false;


    const sleep = ms =>
        new Promise(resolve =>
            setTimeout(resolve, ms)
        );


    /************************************************************
     * UTILIDADES
     ************************************************************/

    function log(...args) {
        console.log(
            TAG,
            ...args
        );
    }


    function norm(text) {
        return (text || '')
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim()
            .toLowerCase();
    }


    function visible(el) {

        if (!el) {
            return false;
        }

        const style =
            getComputedStyle(el);

        const rect =
            el.getBoundingClientRect();

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
        );
    }


    function textOf(el) {

        if (!el) {
            return '';
        }

        return norm(
            el.innerText ||
            el.textContent ||
            el.value ||
            el.getAttribute?.(
                'aria-label'
            ) ||
            el.getAttribute?.(
                'title'
            ) ||
            ''
        );
    }


    function findClickable(
        text,
        exact = false
    ) {

        const wanted =
            norm(text);

        const elements =
            document.querySelectorAll(
                `
                button,
                a,
                label,
                [role="button"],
                [role="radio"],
                [role="checkbox"]
                `
            );


        for (const el of elements) {

            if (!visible(el)) {
                continue;
            }

            const current =
                textOf(el);

            if (
                exact
                    ? current === wanted
                    : current.includes(wanted)
            ) {
                return el;
            }
        }

        return null;
    }


    function getInputFromLabel(label) {

        if (!label) {
            return null;
        }

        const id =
            label.getAttribute('for');

        if (id) {
            return document.getElementById(
                id
            );
        }

        return label.querySelector(
            'input[type="checkbox"], input[type="radio"]'
        );
    }


    /************************************************************
     * STATUS
     ************************************************************/

    function status(
        message,
        type = 'normal'
    ) {

        let box =
            document.getElementById(
                'uah-watch-status'
            );


        if (!box) {

            box =
                document.createElement(
                    'div'
                );

            box.id =
                'uah-watch-status';


            Object.assign(
                box.style,
                {
                    position:
                        'fixed',

                    bottom:
                        '15px',

                    right:
                        '15px',

                    zIndex:
                        '2147483647',

                    padding:
                        '10px 14px',

                    borderRadius:
                        '8px',

                    fontFamily:
                        'Arial, sans-serif',

                    fontSize:
                        '13px',

                    fontWeight:
                        'bold',

                    color:
                        'white',

                    background:
                        '#111',

                    border:
                        '2px solid #666',

                    boxShadow:
                        '0 3px 12px rgba(0,0,0,.4)',

                    maxWidth:
                        '430px',

                    userSelect:
                        'none',

                    pointerEvents:
                        'none'
                }
            );


            document.body.appendChild(
                box
            );
        }


        if (type === 'good') {

            box.style.background =
                '#146b27';

            box.style.border =
                '3px solid white';

        } else if (
            type === 'warning'
        ) {

            box.style.background =
                '#7a4300';

            box.style.border =
                '3px solid #ffcc66';

        } else {

            box.style.background =
                '#111';

            box.style.border =
                '2px solid #666';
        }


        if (
            box.textContent !== message
        ) {
            box.textContent =
                message;
        }
    }


    /************************************************************
     * LIMPIAR TIMERS
     ************************************************************/

    function clearRestartSchedule() {

        if (restartTimer) {

            clearTimeout(
                restartTimer
            );

            restartTimer =
                null;
        }


        if (countdownInterval) {

            clearInterval(
                countdownInterval
            );

            countdownInterval =
                null;
        }
    }


    /************************************************************
     * REINICIO SPA
     *
     * IMPORTANTE:
     * No reload()
     * No location.replace(URL)
     *
     * Solo cambiamos el # de Angular.
     *
     * Eso mantiene el mismo documento y evita
     * el diálogo beforeunload de Firefox.
     ************************************************************/

    async function restartSPA() {

        if (restartInProgress) {
            return;
        }


        restartInProgress =
            true;


        clearRestartSchedule();


        stopNavigation();


        log(
            'Reiniciando flujo usando router SPA...'
        );


        status(
            '↻ Volviendo al inicio de automatrícula…'
        );


        /*
         * Reiniciar estado interno del watcher.
         */
        busy =
            false;

        stopped =
            false;

        availabilityFound =
            false;

        lastAction =
            '';

        lastActionTime =
            0;


        /*
         * Cambiar SOLO el hash.
         *
         * Esto NO abandona la página.
         */
        if (
            location.hash !== START_HASH
        ) {

            location.hash =
                START_HASH;

        } else {

            /*
             * Si por alguna razón ya estamos
             * en bienvenida, forzamos un pequeño
             * salto interno y volvemos.
             */
            location.hash =
                '#/';

            await sleep(
                150
            );

            location.hash =
                START_HASH;
        }


        window.scrollTo({
            top: 0,
            behavior: 'auto'
        });


        /*
         * Dar tiempo a Angular a renderizar.
         */
        await sleep(
            1500
        );


        restartInProgress =
            false;


        status(
            'UAH AUTO v9 — entrando de nuevo…'
        );


        startNavigation();
    }


    /************************************************************
     * CUENTA ATRÁS
     ************************************************************/

    function scheduleRestart(
        durationMs,
        prefix,
        type = 'normal'
    ) {

        clearRestartSchedule();


        const deadline =
            Date.now() +
            durationMs;


        function update() {

            const remaining =
                Math.max(
                    0,
                    deadline - Date.now()
                );


            const seconds =
                Math.ceil(
                    remaining / 1000
                );


            status(
                `${prefix} — nuevo intento en ${seconds} s`,
                type
            );
        }


        update();


        countdownInterval =
            setInterval(
                update,
                1000
            );


        restartTimer =
            setTimeout(
                () => {

                    clearRestartSchedule();

                    restartSPA();

                },
                durationMs
            );
    }


    /************************************************************
     * CLICK SEGURO
     ************************************************************/

    async function clickSafe(
        el,
        action
    ) {

        if (!el) {
            return false;
        }


        const now =
            Date.now();


        if (
            lastAction === action &&
            now - lastActionTime <
                3000
        ) {
            return false;
        }


        lastAction =
            action;


        lastActionTime =
            now;


        log(
            'CLICK:',
            action
        );


        el.scrollIntoView({
            block:
                'center',

            behavior:
                'auto'
        });


        await sleep(
            150
        );


        el.click();


        await sleep(
            700
        );


        return true;
    }


    /************************************************************
     * ERROR DE CONEXIONES
     ************************************************************/

    function maxConnectionsDetected() {

        const text =
            norm(
                document.body.innerText
            );


        return (

            text.includes(
                'se ha superado el numero maximo de conexiones'
            )

            ||

            text.includes(
                'no puede acceder en estos momentos a la matricula'
            )
        );
    }


    function handleMaxConnections() {

        if (
            !maxConnectionsDetected()
        ) {
            return false;
        }


        stopped =
            true;


        stopNavigation();


        log(
            'Máximo de conexiones detectado.'
        );


        scheduleRestart(
            MAX_CONNECTIONS_RETRY_MS,
            '⚠ Máximo de conexiones',
            'warning'
        );


        return true;
    }


    /************************************************************
     * PÁGINA DE ASIGNATURAS
     ************************************************************/

    function subjectPageDetected() {

        const text =
            norm(
                document.body.innerText
            );


        return (
            text.includes(
                'seleccion de asignaturas'
            )

            &&

            text.includes(
                'curso 4'
            )
        );
    }


    /************************************************************
     * DETECTAR "NO"
     ************************************************************/

    function findUnselectedNo() {

        const labels =
            document.querySelectorAll(
                'label'
            );


        for (
            const label of labels
        ) {

            if (!visible(label)) {
                continue;
            }


            if (
                textOf(label) !== 'no'
            ) {
                continue;
            }


            const input =
                getInputFromLabel(
                    label
                );


            if (
                !input ||
                !input.checked
            ) {
                return label;
            }
        }


        const controls =
            document.querySelectorAll(
                `
                [role="radio"],
                [role="button"],
                button
                `
            );


        for (
            const el of controls
        ) {

            if (!visible(el)) {
                continue;
            }


            if (
                textOf(el) !== 'no'
            ) {
                continue;
            }


            const selected =

                el.getAttribute(
                    'aria-checked'
                ) === 'true'

                ||

                el.classList.contains(
                    'active'
                )

                ||

                el.classList.contains(
                    'selected'
                );


            if (!selected) {
                return el;
            }
        }


        return null;
    }


    /************************************************************
     * LOCALIZAR ASIGNATURA
     ************************************************************/

    function findSubjectCard(code) {

        const normalizedCode =
            norm(code);


        const elements =
            document.querySelectorAll(
                `
                article,
                section,
                li,
                div
                `
            );


        let best =
            null;


        let bestLength =
            Infinity;


        for (
            const el of elements
        ) {

            const text =
                textOf(el);


            if (
                text.includes(
                    normalizedCode
                )

                &&

                text.length <
                    bestLength
            ) {

                best =
                    el;

                bestLength =
                    text.length;
            }
        }


        if (!best) {
            return null;
        }


        let current =
            best;


        for (
            let i = 0;
            i < 4;
            i++
        ) {

            if (
                !current.parentElement
            ) {
                break;
            }


            const parent =
                current.parentElement;


            const parentText =
                textOf(parent);


            if (
                parentText.includes(
                    normalizedCode
                )

                &&

                parentText.length <
                    1800
            ) {

                current =
                    parent;
            }


            if (
                parentText.includes(
                    FULL_TEXT
                )
            ) {

                return parent;
            }
        }


        return current;
    }


    /************************************************************
     * SONIDO
     ************************************************************/

    function playSound() {

        try {

            const AudioContext =

                window.AudioContext ||

                window.webkitAudioContext;


            const ctx =
                new AudioContext();


            const oscillator =
                ctx.createOscillator();


            const gain =
                ctx.createGain();


            oscillator.connect(
                gain
            );


            gain.connect(
                ctx.destination
            );


            oscillator.frequency.value =
                880;


            gain.gain.value =
                0.15;


            oscillator.start();


            setTimeout(
                () => {

                    oscillator.stop();

                    ctx.close();

                },
                900
            );


        } catch (error) {

            log(
                'No se pudo reproducir sonido.'
            );
        }
    }


    /************************************************************
     * PLAZA ENCONTRADA
     ************************************************************/

    function notify(
        target,
        card
    ) {

        availabilityFound =
            true;


        stopped =
            true;


        stopNavigation();


        clearRestartSchedule();


        document.title =
            `🚨 PLAZA — ${target.name}`;


        status(
            `🚨 PLAZA POSIBLE: ${target.name}`,
            'good'
        );


        if (card) {

            card.style.outline =
                '6px solid lime';


            card.style.boxShadow =
                '0 0 30px lime';


            card.scrollIntoView({
                behavior:
                    'smooth',

                block:
                    'center'
            });
        }


        playSound();


        try {

            GM_notification({

                title:
                    '🚨 UAH — PLAZA DISPONIBLE',

                text:
                    target.name,

                timeout:
                    0,

                onclick:
                    () => {

                        window.focus();

                        if (card) {

                            card.scrollIntoView({
                                block:
                                    'center',

                                behavior:
                                    'smooth'
                            });
                        }
                    }
            });


        } catch (error) {

            log(
                'GM_notification no disponible.'
            );
        }


        setTimeout(
            () => {

                alert(
                    `🚨 POSIBLE PLAZA LIBRE\n\n` +
                    `${target.name}\n\n` +
                    `Se han detenido los reintentos.\n\n` +
                    `Comprueba y matricúlala YA.`
                );

            },
            500
        );
    }


    /************************************************************
     * ESCANEAR OBJETIVOS
     ************************************************************/

    async function scanTargets() {

        if (
            availabilityFound
        ) {
            return;
        }


        status(
            '🔍 Comprobando Regional, Ambiental, Python y PYMES…'
        );


        await sleep(
            800
        );


        let allFound =
            true;


        for (
            const target of TARGETS
        ) {

            const card =
                findSubjectCard(
                    target.code
                );


            if (!card) {

                allFound =
                    false;


                log(
                    '⚠ No encontrada:',
                    target.name
                );


                continue;
            }


            const full =
                textOf(card)
                    .includes(
                        FULL_TEXT
                    );


            if (full) {

                log(
                    '❌ LLENA:',
                    target.name
                );

            } else {

                log(
                    '🚨 PLAZA POSIBLE:',
                    target.name
                );


                notify(
                    target,
                    card
                );


                return;
            }
        }


        if (
            !availabilityFound
        ) {

            if (allFound) {

                scheduleRestart(
                    REFRESH_MS,
                    '❌ Las 4 siguen llenas'
                );

            } else {

                scheduleRestart(
                    REFRESH_MS,
                    '⚠ Escaneo incompleto',
                    'warning'
                );
            }
        }
    }


    /************************************************************
     * ABRIR CURSO 4
     ************************************************************/

    async function openCurso4() {

        let el =

            findClickable(
                'curso 4',
                true
            )

            ||

            findClickable(
                'curso 4'
            );


        if (!el) {

            window.scrollTo({

                top:
                    document.documentElement
                        .scrollHeight,

                behavior:
                    'auto'
            });


            await sleep(
                400
            );


            el =

                findClickable(
                    'curso 4',
                    true
                )

                ||

                findClickable(
                    'curso 4'
                );
        }


        if (!el) {

            return false;
        }


        await clickSafe(
            el,
            'OPEN_CURSO_4'
        );


        stopped =
            true;


        stopNavigation();


        status(
            '🔍 Curso 4 abierto — comprobando plazas…'
        );


        await sleep(
            1000
        );


        await scanTargets();


        return true;
    }


    /************************************************************
     * NAVEGACIÓN AUTOMÁTICA
     ************************************************************/

    async function navigationTick() {

        if (
            busy ||
            stopped ||
            restartInProgress
        ) {
            return;
        }


        if (
            handleMaxConnections()
        ) {
            return;
        }


        busy =
            true;


        try {

            /*
             * SELECCIÓN DE ASIGNATURAS
             */

            if (
                subjectPageDetected()
            ) {

                await openCurso4();

                return;
            }


            /*
             * COMENZAR MATRÍCULA
             */

            let el =

                findClickable(
                    'comenzar la matricula'
                )

                ||

                findClickable(
                    'comenzar matrícula'
                );


            if (el) {

                await clickSafe(
                    el,
                    'START'
                );


                return;
            }


            /*
             * DATOS PERSONALES
             */

            el =
                findClickable(
                    'confirmo que mis datos personales son correctos'
                );


            if (el) {

                const input =
                    getInputFromLabel(
                        el
                    );


                if (
                    !input ||
                    !input.checked
                ) {

                    await clickSafe(
                        el,
                        'PERSONAL_DATA'
                    );


                    return;
                }
            }


            /*
             * TIEMPO COMPLETO
             */

            el =
                findClickable(
                    'a tiempo completo'
                );


            if (el) {

                await clickSafe(
                    el,
                    'FULL_TIME'
                );


                return;
            }


            /*
             * NO
             */

            const no =
                findUnselectedNo();


            if (no) {

                await clickSafe(
                    no,
                    'NO_' +
                        textOf(no)
                );


                /*
                 * Permitir segundo NO.
                 */
                lastAction =
                    '';


                return;
            }


            /*
             * CONTINUAR
             */

            el =
                findClickable(
                    'continuar',
                    true
                );


            if (el) {

                await clickSafe(

                    el,

                    'CONTINUE_' +
                        location.hash

                );


                return;
            }


        } catch (error) {

            console.error(
                TAG,
                error
            );


            status(
                '⚠ Error de navegación',
                'warning'
            );


        } finally {

            busy =
                false;
        }
    }


    /************************************************************
     * POLLING
     ************************************************************/

    function startNavigation() {

        if (
            navigationInterval
        ) {
            return;
        }


        navigationInterval =
            setInterval(
                navigationTick,
                NAVIGATION_POLL_MS
            );


        navigationTick();
    }


    function stopNavigation() {

        if (
            navigationInterval
        ) {

            clearInterval(
                navigationInterval
            );


            navigationInterval =
                null;
        }
    }


    /************************************************************
     * INICIO
     ************************************************************/

    log(
        '=================================='
    );

    log(
        'UAH Cazador de Plazas v9'
    );

    log(
        'Reinicio SPA sin reload'
    );

    log(
        'Cuenta atrás activa'
    );

    log(
        'Objetivos:',
        TARGETS
    );

    log(
        '=================================='
    );


    status(
        'UAH AUTO v9 — iniciando…'
    );


    if (
        !handleMaxConnections()
    ) {

        startNavigation();
    }

})();

// ---------- Hudba ----------
// Soubory musí být ve složce music/ (název bez přípony).
function addDeiaMusic(){
    const s = Vars.control.sound;
    try{
        const m = Vars.tree.loadMusic("deia-theme");
        if(!s.ambientMusic.contains(m)) s.ambientMusic.add(m);
    }catch(err){
        Log.warn("[JS Mod] Hudba deia-theme nenalezena: " + err);
    }
    try{
        const m2 = Vars.tree.loadMusic("deia-btheme");
        // pozor: kontrola i přidání musí být do STEJNÉHO seznamu
        if(!s.darkMusic.contains(m2)) s.darkMusic.add(m2);
    }catch(err){
        Log.warn("[JS Mod] Hudba deia-btheme nenalezena: " + err);
    }
}
Events.on(MusicRegisterEvent, addDeiaMusic);
Events.on(ClientLoadEvent, addDeiaMusic);

// ---------- 1. Efekt zeleného kouře ----------
const bigGreenSmoke = new Effect(60, e => {
    Draw.color(Color.valueOf("2b8f3c"));

    // 5 náhodných obláčků kouře
    for(let i = 0; i < 5; i++){
        let angle = e.rotation + Mathf.range(30); // rozptyl 30 stupňů
        let speed = e.fin() * 40;                 // jak daleko kouř doletí

        let x = e.x + Mathf.cosDeg(angle) * speed;
        let y = e.y + Mathf.sinDeg(angle) * speed;

        let size = 3 + e.fslope() * 8;

        Fill.circle(x, y, size);
    }
});

// (Fx je Java třída, nové vlastnosti do ní přidat nejde. Efekt se používá přímo jako proměnná bigGreenSmoke.)

// ---------- 2. Logika Uranového destilátoru ----------
Events.on(ClientLoadEvent, () => {
    const distillerBlock = Vars.content.getByName(ContentType.block, "deia-uranium-distiller");

    if(distillerBlock != null){

        distillerBlock.buildType = () => extend(GenericCrafter.GenericCrafterBuild, distillerBlock, {

            updateTile(){
                // původní logika crafteru (normální výroba)
                this.super$updateTile();

                // zelený kouř při práci
                if(this.wasConsumed){
                    if(Mathf.chance(0.08)){
                        bigGreenSmoke.at(this.x + Mathf.range(4), this.y + Mathf.range(4));
                    }
                }

                // NEBEZPEČNÁ MECHANIKA: v budově je materiál, ale došla voda
                if(this.liquids.get(Liquids.water) <= 0.01 && this.items.total() > 0){
                    // varovný výbuch jen občas (ne v každém snímku)
                    if(Mathf.chance(0.05)){
                        Fx.reactorExplosion.at(this.x + Mathf.range(8), this.y + Mathf.range(8));
                    }

                    // budova pomalu ubírá sobě životy
                    this.damage(0.5);

                    // radiace poškodí okolí včetně vlastních budov
                    // (Team.derelict: jeho "nepřáteli" jsou všichni ostatní)
                    Damage.damage(Team.derelict, this.x, this.y, 50, 2);
                }
            }
        });

        Log.info("[JS Mod] Unikátní mechanika úspěšně aplikována na Uranový Destilátor!");
    }else{
        Log.warn("[JS Mod] Nepodařilo se najít blok uranium-distiller v HJSON.");
    }
});
// TODO (neoplazma, rozpracováno): if(unit != null && unit.hasStatus(StatusEffects.sapped)) { ... (nedokončený blok zakomentován, aby se skript načetl)


// ---------- 3. Na Deii je všechno ze Serpulu + obsah Deie ----------
// a) Celý obsah Serpulu se zobrazí i na planetě Deie (build menu, databáze).
Events.on(ClientLoadEvent, () => {
    const deie = Vars.content.getByName(ContentType.planet, "deia-deie");
    if(deie == null){
        Log.warn("[JS Mod] Planeta deia-deie nenalezena, obsah Serpulu se nepřidá.");
        return;
    }
    let n = 0;
    Vars.content.each(c => {
        if(c instanceof UnlockableContent && c.shownPlanets.contains(Planets.serpulo)){
            c.shownPlanets.add(deie);
            n++;
        }
    });
    Log.info("[JS Mod] Na Deii zpřístupněno " + n + " položek ze Serpulu.");
});

// b) Při vstupu do sektoru na Deii se obsah Serpulu odemkne (vrty, dopravníky, ...).
Events.on(WorldLoadEvent, () => {
    const sector = Vars.state.rules.sector;
    if(sector == null || sector.planet == null || sector.planet.name != "deia-deie") return;
    Vars.content.each(c => {
        if(c instanceof UnlockableContent && c.shownPlanets.contains(Planets.serpulo) && !c.unlocked()){
            c.unlock();
        }
    });
});


// ---------- 4. Research tree Deie = strom Serpulu + obsah Deie ----------
// Serpulský strom se připojí pod kořen Deie (Jádro: Deia). Serpulo samotné zůstává beze změny.
Events.on(ClientLoadEvent, () => {
    const deie = Vars.content.getByName(ContentType.planet, "deia-deie");
    const serpulo = Planets.serpulo;
    if(deie == null || deie.techTree == null || serpulo.techTree == null){
        Log.warn("[JS Mod] Research tree: planeta nebo strom nenalezen, Serpulo se nepřipojí.");
        return;
    }
    const deieRoot = deie.techTree;
    const serpuloRoot = serpulo.techTree;

    if(deieRoot.children.contains(serpuloRoot)) return; // už připojeno

    serpuloRoot.parent = deieRoot;
    deieRoot.children.add(serpuloRoot);
    serpuloRoot.addPlanet(deie); // obsah Serpulu bude viditelný i na Deii

    Log.info("[JS Mod] Strom Serpulu připojen pod kořen Deie.");
});

// ---------- 5. Radiační filtr ----------
// Normálně sbírá z ovzduší trochu radiace (hjson). Po radiačním výbuchu (Thoriový reaktor, Rázový reaktor,
// Uranový destilátor) produkce prudce stoupne a pomalu klesá k normálu. Filtr také zmírní poškození okolí.
const radSurge = {}; // pozice budovy -> aktuální násobek produkce navíc
const radShield = {}; // pozice filtru -> do kdy je imunní vůči výbuchu (Time.time)
const reactorOrig = {}; // název bloku -> původní [explosionDamage, explosionRadius]

Events.on(ClientLoadEvent, () => {
    const filterBlock = Vars.content.getByName(ContentType.block, "deia-radiation-filter");
    const radiation = Vars.content.getByName(ContentType.liquid, "deia-radiation");
    if(filterBlock == null || radiation == null){
        Log.warn("[JS Mod] Radiační filtr nebo radiace nenalezeny v HJSON.");
        return;
    }

    const BASE = 0.06;          // běžná produkce za tick (stejná jako v hjson)
    const DECAY = 0.9996;       // pomalý pokles k normálu (poločas cca 30 s)

    filterBlock.buildType = () => extend(GenericCrafter.GenericCrafterBuild, filterBlock, {
        // během radiačního výbuchu je filtr nezranitelný (výbuch ho nezničí, jen mu zvýší produkci)
        handleDamage(amount){
            const until = radShield[this.pos()];
            if(until !== undefined && until > Time.time) return 0;
            return this.super$handleDamage(amount);
        },
        // radiace smí z filtru jen do radiačních bloků, ne do klasických potrubí
        transferLiquid(next, amount, liquid){
            if(liquid == radiation && !radOk(next)) return 0;
            return this.super$transferLiquid(next, amount, liquid);
        },
        updateTile(){
            this.super$updateTile();
            const k = this.pos();
            let surge = radSurge[k];
            if(surge === undefined) return;
            if(surge < 0.01){ delete radSurge[k]; return; }

            if(this.efficiency > 0){
                const room = filterBlock.liquidCapacity - this.liquids.get(radiation);
                const add = Math.min(room, BASE * surge * Time.delta);
                if(add > 0) this.liquids.add(radiation, add);
            }
            radSurge[k] = surge * Math.pow(DECAY, Time.delta);
            this.dumpLiquid(radiation);
        }
    });

    const SURGE_PEAK = 40;           // špičkový násobek produkce po výbuchu
    const SURGE_RANGE = 100 * 8;     // filtry do 100 polí od výbuchu zareagují
    const PROTECT_RANGE = 25 * 8;    // filtr chrání budovy do 25 polí od sebe
    const BLAST_RANGE = 30 * 8;      // poloměr, ve kterém se škody počítají
    const MITIGATE = 0.6;            // podíl ztraceného zdraví, který se vrátí

    Events.on(BlockDestroyEvent, e => {
        const t = e.tile;
        if(t == null) return;
        const blk = t.block();
        const isRad = blk instanceof Packages.mindustry.world.blocks.power.NuclearReactor
            || blk instanceof Packages.mindustry.world.blocks.power.ImpactReactor
            || blk.name == "deia-uranium-distiller";
        if(!isRad) return;

        const x = t.worldx(), y = t.worldy();
        const filters = [];
        Groups.build.each(b => {
            if(b.block == filterBlock && b.dst(x, y) <= SURGE_RANGE) filters.push(b);
        });
        if(filters.length == 0) return;

        filters.forEach(f => { radSurge[f.pos()] = Math.max(radSurge[f.pos()] || 0, SURGE_PEAK); });
        filters.forEach(f => { radShield[f.pos()] = Time.time + 180; });

        // zmírnění: reaktor vybuchne s menší silou a dosahem (hodnoty se hned vrátí zpět)
        if(typeof blk.explosionDamage === "number" && blk.explosionDamage > 0 && reactorOrig[blk.name] === undefined){
            reactorOrig[blk.name] = [blk.explosionDamage, blk.explosionRadius];
            blk.explosionDamage = Math.max(1, Math.floor(blk.explosionDamage * 0.2));
            blk.explosionRadius = Math.max(1, Math.floor(blk.explosionRadius * 0.7));
            Time.run(3, () => {
                const o = reactorOrig[blk.name];
                if(o !== undefined){
                    blk.explosionDamage = o[0];
                    blk.explosionRadius = o[1];
                    delete reactorOrig[blk.name];
                }
            });
        }

        // zmírnění: zapamatujeme zdraví, po výbuchu vrátíme část ztraceného
        const prot = [];
        Groups.build.each(b => {
            if(b.dst(x, y) > BLAST_RANGE) return;
            for(let i = 0; i < filters.length; i++){
                if(filters[i].team == b.team && filters[i].dst(b) <= PROTECT_RANGE){
                    prot.push([b, b.health]);
                    return;
                }
            }
        });
        Time.run(2, () => {
            prot.forEach(p => {
                const b = p[0];
                const lost = p[1] - b.health;
                if(b.isValid() && lost > 0) b.heal(lost * MITIGATE);
            });
        });
    });
});

// ---------- 6. Lékař proti neoplazmě ----------
// Antineoplazma: louže neoplazmy v jejím dosahu zničí.
// Stabilizátor: louže neoplazmy přemění na Prospěšnou neoplazmu (hojí budovy, posiluje jednotky).
Events.on(ClientLoadEvent, () => {
    const anti = Vars.content.getByName(ContentType.liquid, "deia-anti-neoplasm");
    const stab = Vars.content.getByName(ContentType.liquid, "deia-stabilizer");
    const benign = Vars.content.getByName(ContentType.liquid, "deia-benign-neoplasm");
    if(anti == null || stab == null || benign == null){
        Log.warn("[JS Mod] Kapaliny proti neoplazmě nenalezeny v HJSON.");
        return;
    }
    const REACH = 18;      // dosah reakce mezi loužemi (jednotky světa)
    const PERIOD = 20;     // jak často se louže kontrolují (snímky)
    const HEAL = 3;        // kolik zdraví hojí Prospěšná neoplazma budovám na louži za kontrolu
    let timer = 0;

    Events.run(Trigger.update, () => {
        if(!Vars.state.isGame()) return;
        timer += Time.delta;
        if(timer < PERIOD) return;
        timer = 0;

        const neo = [], cures = [], goods = [];
        Groups.puddle.each(p => {
            if(p.liquid == Liquids.neoplasm) neo.push(p);
            else if(p.liquid == anti || p.liquid == stab) cures.push(p);
            else if(p.liquid == benign) goods.push(p);
        });

        neo.forEach(np => {
            for(let i = 0; i < cures.length; i++){
                const c = cures[i];
                if(c.amount <= 0.05 || np.dst(c) > REACH) continue;
                const used = Math.min(c.amount, np.amount * 0.5 + 0.3);
                const tile = Vars.world.tileWorld(np.x, np.y);
                if(c.liquid == anti){
                    // zničení: neoplazma ubývá, dokud se louže nevypaří
                    np.amount -= used * 2;
                    c.amount -= used;
                    if(np.amount <= 0.1) np.remove();
                }else{
                    // úprava: neoplazma se změní na prospěšnou
                    const amt = np.amount;
                    c.amount -= used;
                    np.remove();
                    if(tile != null) Puddles.deposit(tile, benign, amt * 0.8);
                }
                break;
            }
        });

        // Prospěšná neoplazma hojí budovy, na kterých leží
        goods.forEach(g => {
            const t = Vars.world.tileWorld(g.x, g.y);
            if(t != null && t.build != null) t.build.heal(HEAL);
        });
    });
});

// ---------- 7. Radiace nejde klasickým potrubím ----------
// Seznam bloků, které smí radiaci přijímat a předávat (další spotřebiče sem můžeš doplnit).
const RAD_OK = [
    "deia-radiation-filter", "deia-radiation-tube", "deia-radiation-tank", "deia-radiation-bridge",
    "deia-uranium-distiller", "deia-thorium_factory"
];
function radOk(b){
    return b != null && RAD_OK.indexOf(b.block.name) >= 0;
}

Events.on(ClientLoadEvent, () => {
    const radiation = Vars.content.getByName(ContentType.liquid, "deia-radiation");
    if(radiation == null) return;

    // Radiační trubice, sklad a most: přijímají JEN radiaci a posílají ji JEN do radiačních bloků.
    function radiationOnly(blockName, buildClass){
        const blk = Vars.content.getByName(ContentType.block, blockName);
        if(blk == null){
            Log.warn("[JS Mod] Blok " + blockName + " nenalezen v HJSON.");
            return;
        }
        blk.buildType = () => extend(buildClass, blk, {
            acceptLiquid(source, liquid){
                return liquid == radiation && this.super$acceptLiquid(source, liquid);
            },
            transferLiquid(next, amount, liquid){
                if(liquid == radiation && !radOk(next)) return 0;
                return this.super$transferLiquid(next, amount, liquid);
            },
            moveLiquid(next, liquid){
                if(liquid == radiation && !radOk(next)) return 0;
                return this.super$moveLiquid(next, liquid);
            }
        });
    }
    radiationOnly("deia-radiation-tube", Conduit.ConduitBuild);
    radiationOnly("deia-radiation-tank", LiquidRouter.LiquidRouterBuild);
    radiationOnly("deia-radiation-bridge", LiquidBridge.LiquidBridgeBuild);
});

// ---------- 8. Lékař míří na ty, kdo ho potřebují ----------
// 1) Míří JEN na budovy u louží neoplazmy (infekce). Obyčejně poškozené budovy neléčí.
// 2) Co vyléčí, to je na 10 s IMUNNÍ: neoplazma v jejím okolí zmizí a Lékař se přesune k dalšímu cíli.
// 3) Lékař sám je vůči neoplazmě imunní.
const doctorImmune = {};   // pozice budovy -> kdy imunita končí (Time.time)
function isImmune(b){
    const until = doctorImmune[b.pos()];
    return until !== undefined && until > Time.time;
}

Events.on(ClientLoadEvent, () => {
    const doc = Vars.content.getByName(ContentType.block, "deia-doctor");
    const anti = Vars.content.getByName(ContentType.liquid, "deia-anti-neoplasm");
    const stab = Vars.content.getByName(ContentType.liquid, "deia-stabilizer");
    const benign = Vars.content.getByName(ContentType.liquid, "deia-benign-neoplasm");
    if(doc == null || anti == null || stab == null || benign == null){
        Log.warn("[JS Mod] Lékař nebo jeho kapaliny nenalezeny v HJSON.");
        return;
    }
    const IMMUNE_TIME = 600;     // 10 s imunity po vyléčení
    const CURE_RADIUS = 40;      // poloměr, ve kterém léčivo zasáhne louže neoplazmy kolem cíle
    const IMMUNE_RADIUS = 24;    // poloměr imunní zóny kolem budovy
    const docTimer = {};

    // vyléčí louže neoplazmy v okolí bodu (x, y) podle použité kapaliny
    function cureAround(x, y, liq){
        const list = [];
        Groups.puddle.each(p => { if(p.liquid == Liquids.neoplasm && p.dst(x, y) <= CURE_RADIUS) list.push(p); });
        list.forEach(np => {
            if(liq == anti){
                np.remove();
            }else{
                const tile = Vars.world.tileWorld(np.x, np.y);
                const amt = np.amount;
                np.remove();
                if(tile != null) Puddles.deposit(tile, benign, amt * 0.8);
            }
        });
    }

    doc.buildType = () => extend(LiquidTurret.LiquidTurretBuild, doc, {
        findTarget(){
            const range = this.range();
            let best = null;

            // jen budova poblíž louže neoplazmy (nejbližší), která není imunní
            {
                let bestDst = 1e9;
                Groups.puddle.each(p => {
                    if(p.liquid != Liquids.neoplasm || p.dst(this) > range) return;
                    const b = Vars.indexer.findTile(this.team, p.x, p.y, 24, bb => bb != this && !isImmune(bb));
                    if(b != null){
                        const d = p.dst(b);
                        if(d < bestDst){ bestDst = d; best = b; }
                    }
                });
            }
            this.target = best;
        },

        updateTile(){
            this.super$updateTile();
            const k = this.pos();
            docTimer[k] = (docTimer[k] || 0) + Time.delta;
            if(docTimer[k] < 15) return;
            docTimer[k] = 0;

            // během střelby na cíl: vyléčit neoplazmu kolem něj a cíl na čas zimunnit
            const t = this.target;
            if(t != null && t instanceof Building && this.hasAmmo()){
                const liq = this.liquids.current();
                if(liq == anti || liq == stab){
                    cureAround(t.x, t.y, liq);
                    doctorImmune[t.pos()] = Time.time + IMMUNE_TIME;
                }
            }
        }
    });

    // imunní zóny: v okolí imunních budov a u samotných Lékařů neoplazma mizí
    let timer = 0;
    Events.run(Trigger.update, () => {
        if(!Vars.state.isGame()) return;
        timer += Time.delta;
        if(timer < 20) return;
        timer = 0;

        const centers = [];
        Object.keys(doctorImmune).forEach(k => {
            if(doctorImmune[k] <= Time.time){ delete doctorImmune[k]; return; }
            const b = Vars.world.build(parseInt(k));
            if(b != null) centers.push(b);
        });
        Groups.build.each(b => { if(b.block == doc) centers.push(b); });
        if(centers.length == 0) return;

        const kill = [];
        Groups.puddle.each(p => {
            if(p.liquid != Liquids.neoplasm) return;
            for(let i = 0; i < centers.length; i++){
                if(p.dst(centers[i]) <= IMMUNE_RADIUS + centers[i].block.size * 4){ kill.push(p); return; }
            }
        });
        kill.forEach(p => p.remove());
    });
});

// ---------- 9. Zvířata na Deii (ptáci a motýli) ----------
// Neškodné jednotky týmu Derelict, které se po mapě volně potulují.
// Objeví se na planetě Deie a také v mapách Deia / Efrakto / Selefo / Maia (i při testování v editoru).
Events.on(ClientLoadEvent, () => {
    const DEBUG = true;   // při true se při spawnu ukáže zpráva (pro ladění; později přepiš na false)
    const MAP_NAMES = ["Deia", "Efrakto", "Selefo", "Maia", "deie-1", "deie-2", "deie-3", "deie-4"];

    const bird = Vars.content.getByName(ContentType.unit, "deia-bird");
    const butterfly = Vars.content.getByName(ContentType.unit, "deia-butterfly");
    if(bird == null || butterfly == null){
        Log.warn("[JS Mod] Zvířata (deia-bird, deia-butterfly) nenalezena v HJSON.");
        return;
    }

    // Jednoduché potulování: vybere náhodný cíl v okolí, letí k němu, po čase vybere nový.
    function wanderAI(radius, wobble){
        return () => {
            let tx = 0, ty = 0, has = false, timer = 0, next = 0, failed = false;
            return extend(AIController, {
                updateMovement(){
                    const u = this.unit;
                    if(u == null || failed) return;
                    try{
                        timer += Time.delta;
                        if(!has || timer > next || Mathf.within(u.x, u.y, tx, ty, 12)){
                            const maxX = Vars.world.width() * 8 - 16, maxY = Vars.world.height() * 8 - 16;
                            tx = Mathf.clamp(u.x + Mathf.range(radius), 16, maxX);
                            ty = Mathf.clamp(u.y + Mathf.range(radius), 16, maxY);
                            has = true; timer = 0; next = 60 * Mathf.random(4, 9);
                        }
                        const ang = Angles.angle(u.x, u.y, tx, ty) + Mathf.range(wobble);
                        u.rotation = Angles.moveToward(u.rotation, ang, 4 * Time.delta);
                        u.moveAt(Tmp.v2.trns(u.rotation, u.speed()));
                    }catch(err){
                        failed = true;
                        Log.err("[JS Mod] Chyba pohybu zvířete: " + err);
                    }
                }
            });
        };
    }
    [[bird, 400, 3], [butterfly, 120, 25]].forEach(a => {
        a[0].aiController = wanderAI(a[1], a[2]);
        a[0].controller = u => a[0].aiController.get();   // jinak by tým Derelict dostal ovládání příkazy
    });

    function spawn(type, count, ok){
        let made = 0;
        const w = Vars.world.width(), h = Vars.world.height();
        for(let i = 0; i < count; i++){
            for(let tries = 0; tries < 25; tries++){
                const t = Vars.world.tile(Mathf.random(4, w - 5) | 0, Mathf.random(4, h - 5) | 0);
                if(t != null && ok(t)){
                    const u = type.create(Team.derelict);
                    u.set(t.worldx(), t.worldy());
                    u.rotation = Mathf.random(360);
                    u.add();
                    made++;
                    break;
                }
            }
        }
        return made;
    }

    function isDeiaMap(){
        const sector = Vars.state.rules.sector;
        if(sector != null && sector.planet != null && sector.planet.name == "deia-deie") return true;
        const planet = Vars.state.rules.planet;
        if(planet != null && planet.name == "deia-deie") return true;
        const map = Vars.state.map;
        return map != null && MAP_NAMES.indexOf(String(map.name())) >= 0;
    }

    Events.on(WorldLoadEvent, () => {
        Time.run(90, () => {
            try{
                if(!Vars.state.isGame()) return;
                if(!isDeiaMap()){
                    Log.info("[JS Mod] Zvířata: tato mapa není z Deie, nespawnuji.");
                    return;
                }
                const area = Vars.world.width() * Vars.world.height();
                let haveBirds = 0, haveButterflies = 0;
                Groups.unit.each(u => {
                    if(u.type == bird) haveBirds++;
                    else if(u.type == butterfly) haveButterflies++;
                });
                const b = spawn(bird, Math.floor(area / 1800) - haveBirds, t => true);
                const f = spawn(butterfly, Math.floor(area / 1200) - haveButterflies, t => !t.floor().isLiquid && t.block() == Blocks.air);
                const msg = "[JS Mod] Zvířata: vytvořeno " + b + " ptáků a " + f + " motýlů (už bylo " + haveBirds + " / " + haveButterflies + ").";
                Log.info(msg);
                if(DEBUG) Vars.ui.showInfoToast(msg, 4);
            }catch(err){
                Log.err("[JS Mod] Chyba při spawnu zvířat: " + err);
                if(DEBUG) Vars.ui.showInfoToast("Chyba zvířat: " + err, 6);
            }
        });
    });
    Log.info("[JS Mod] Zvířata zaregistrována.");
});


// ---------- 10. Vodní elektrárna běží, i když je voda plná ----------
Events.on(ClientLoadEvent, () => {
    const plant = Vars.content.getByName(ContentType.block, "deia-hydro-plant");
    if(plant == null){
        Log.warn("[JS Mod] Vodní elektrárna (deia-hydro-plant) nenalezena v HJSON.");
        return;
    }
    plant.buildType = () => extend(ConsumeGenerator.ConsumeGeneratorBuild, plant, {
        shouldConsume(){ return true; }   // nezastaví se, i když je nádrž s vodou plná
    });
});

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

// Efekt je dostupný pod názvem "bigGreenSmoke"
Fx["bigGreenSmoke"] = bigGreenSmoke;

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
// Vanilla turret s targetHealing míří na poškozené spojenecké budovy. Navíc míří na budovy u louží neoplazmy.
Events.on(ClientLoadEvent, () => {
    const doc = Vars.content.getByName(ContentType.block, "deia-doctor");
    if(doc == null){
        Log.warn("[JS Mod] Lékař (deia-doctor) nenalezen v HJSON.");
        return;
    }
    doc.buildType = () => extend(LiquidTurret.LiquidTurretBuild, doc, {
        findTarget(){
            this.super$findTarget();
            if(this.target != null) return;

            // nakažené: nejbližší vlastní budova u louže neoplazmy
            const range = this.range();
            let best = null, bestDst = 1e9;
            Groups.puddle.each(p => {
                if(p.liquid != Liquids.neoplasm || p.dst(this) > range) return;
                const b = Vars.indexer.findTile(this.team, p.x, p.y, 24, bb => bb != this);
                if(b != null){
                    const d = p.dst(b);
                    if(d < bestDst){ bestDst = d; best = b; }
                }
            });
            if(best != null) this.target = best;
        }
    });
});

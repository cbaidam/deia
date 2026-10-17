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
                if(this.liquids.currentAmount() <= 0.01 && this.items.total() > 0){
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

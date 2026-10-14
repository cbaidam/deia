// 1. Globální registrace tvého vlastního JS efektu zeleného kouře
const bigGreenSmoke = new Effect(60, e => {
    Draw.color(Color.valueOf("2b8f3c"));
    
    // Vytvoříme 5 náhodných obláčků kouře
    for(let i = 0; i < 5; i++){
        let angle = e.rotation + Mathf.range(30); // rozptyl 30 stupňů
        let speed = e.fin() * 40; // jak daleko kouř doletí
        
        let x = e.x + Mathf.cosDeg(angle) * speed;
        let y = e.y + Mathf.sinDeg(angle) * speed;
        
        let size = 3 + e.fslope() * 8;
        
        Fill.circle(x, y, size);
    }
});

// Přidáme efekt do globálního herního registru Fx pod požadovaným názvem
Fx["bigGreenSmoke"] = bigGreenSmoke;

// 2. Inicializace a přepsání logiky tvé nové budovy (Uranový Destilátor)
Events.on(ClientLoadEvent, () => {
    // Najdeme blok z HJSON podle interního názvu tvého modu (deia)
    const distillerBlock = Vars.content.getByName(ContentType.block, "deia-uranium-distiller");

    if (distillerBlock != null) {
        
        // Přepíšeme logiku budovy (Entity build)
        distillerBlock.buildType = () => extend(GenericCrafter.GenericCrafterBuild, distillerBlock, {
            
            // Tady definujeme, co se děje v KAŽDÉM snímku hry (60x za sekundu)
            updateTile() {
                // Spustíme původní logiku GenericCrafteru (aby budova normálně vyráběla)
                this.super$updateTile();

                // Pokud budova zrovna vyrábí a je aktivní
                if (this.wasConsumed) {
                    // Jednou za čas (každých cca 12 snímků) vytvoříme zelený kouř
                    if (Mathf.chance(0.08)) {
                        bigGreenSmoke.at(this.x + Mathf.range(4), this.y + Mathf.range(4));
                    }
                }

                // NEBEZPEČNÁ MECHANIKA: Pokud v budově dojdou tekutiny (voda), radiace se vymkne kontrole!
                if (this.liquids.currentAmount() <= 0.01 && this.wasConsumed) {
                    // Vizuální varování – blikající červené částice výbuchu reaktoru
                    Fx.reactorExplosion.at(this.x + Mathf.range(8), this.y + Mathf.range(8));
                    
                    // Budova začne pomalu ubírat životy sama sobě
                    this.damage(0.5);

                    // Radiace poškodí okolní bloky (v okruhu 50 pixelů udělí poškození 2)
                    Damage.damage(this.team, this.x, this.y, 50, 2);
                }
            }
        });

        Log.info("[JS Mod] Unikátní mechanika úspěšně aplikována na Uranový Destilátor!");
    } else {
        Log.warn("[JS Mod] Nepodařilo se najít blok uranium-distiller v HJSON.");
    }
});

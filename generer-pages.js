const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ==========================================
// CONFIGURATION
// ==========================================

const ROOT = __dirname;
const INDEX_FILE = path.join(ROOT, "index.html");
const GROUPS_DIR = path.join(ROOT, "groupes");
const IMAGES_DIR = path.join(GROUPS_DIR, "images");

// IMPORTANT : remplace par ton véritable lien GitHub Pages.
const SITE_URL = "https://VOTRE-PSEUDO.github.io/VOTRE-DEPOT";

// La fiche BLACKPINK sert de référence pour le design.
const TEMPLATE_FILE = path.join(GROUPS_DIR, "blackpink.html");

// ==========================================
// OUTILS
// ==========================================

function slugify(value) {
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function escapeJSON(value) {
    return JSON.stringify(value, null, 2)
        .replace(/</g, "\\u003c");
}

// Récupère une déclaration JavaScript contenant
// un objet ou un tableau littéral.
function extractDeclaration(source, name) {
    const expression = new RegExp(
        `(?:const|let|var)\\s+${name}\\s*=\\s*([\\[\\{])`
    );

    const match = source.match(expression);

    if (!match) {
        throw new Error(`Déclaration ${name} introuvable.`);
    }

    const start = match.index + match[0].length - 1;

    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let i = start; i < source.length; i++) {
        const c = source[i];
        const next = source[i + 1];

        if (lineComment) {
            if (c === "\n") lineComment = false;
            continue;
        }

        if (blockComment) {
            if (c === "*" && next === "/") {
                blockComment = false;
                i++;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (c === "\\") {
                escaped = true;
                continue;
            }

            if (c === quote) quote = null;
            continue;
        }

        if (c === "/" && next === "/") {
            lineComment = true;
            i++;
            continue;
        }

        if (c === "/" && next === "*") {
            blockComment = true;
            i++;
            continue;
        }

        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }

        if (c === "[" || c === "{") depth++;

        if (c === "]" || c === "}") {
            depth--;

            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }

    throw new Error(`Fin de déclaration ${name} introuvable.`);
}

// ==========================================
// LECTURE DE LA BASE IBASE
// ==========================================

function readDatabase() {
    if (!fs.existsSync(INDEX_FILE)) {
        throw new Error("index.html est introuvable.");
    }

    const source = fs.readFileSync(INDEX_FILE, "utf8");

    const photosSource = extractDeclaration(source, "memberPhotos");

    const photos = vm.runInNewContext(
        `(${photosSource})`,
        {},
        { timeout: 10000 }
    );

    const groupsSource = extractDeclaration(source, "groupsData");

    const groups = vm.runInNewContext(
        `(${groupsSource})`,
        { memberPhotos: photos },
        { timeout: 10000 }
    );

    if (!Array.isArray(groups)) {
        throw new Error("groupsData n'est pas un tableau.");
    }

    return groups;
}

// ==========================================
// GESTION DES IMAGES
// ==========================================

function saveImage(value, filename) {
    if (!value || typeof value !== "string") return "";

    if (value.startsWith("data:image/")) {
        const match = value.match(
            /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/
        );

        if (!match) return "";

        const extension = match[1] === "jpeg"
            ? "jpg"
            : match[1].replace("svg+xml", "svg");

        const finalName = `${filename}.${extension}`;
        const destination = path.join(IMAGES_DIR, finalName);

        fs.writeFileSync(
            destination,
            Buffer.from(match[2], "base64")
        );

        return `images/${finalName}`;
    }

    if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
        return value;
    }

    return value.startsWith("../") ? value : `../${value}`;
}

function findImage(object, fields, filename) {
    for (const field of fields) {
        const value = object?.[field];

        if (typeof value === "string" && value.trim()) {
            return saveImage(value, filename);
        }
    }

    return "";
}

// ==========================================
// TEMPLATE DESIGN
// ==========================================

function readTemplateCSS() {
    if (!fs.existsSync(TEMPLATE_FILE)) {
        console.warn(
            "Fiche BLACKPINK absente : utilisation du style de secours."
        );

        return `
            body { font-family: Arial, sans-serif; background:#f9edf4; }
            .group-seo-card { background:white; border-radius:25px; }
            .group-seo-body { padding:25px; }
            .member-seo-grid {
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
                gap:18px;
            }
        `;
    }

    const template = fs.readFileSync(TEMPLATE_FILE, "utf8");

    const match = template.match(
        /<style[^>]*>([\s\S]*?)<\/style>/i
    );

    if (!match) {
        throw new Error("CSS introuvable dans la fiche modèle.");
    }

    return match[1];
}

// ==========================================
// PROFILS DES MEMBRES
// ==========================================

function renderMembers(members, slug, groupName) {
    if (!Array.isArray(members) || !members.length) {
        return "<p>Les profils détaillés des membres seront ajoutés prochainement.</p>";
    }

    return members.map((member, index) => {
        const name = member.name || "Membre";
        const photo = findImage(
            member,
            ["image", "photo", "img", "profileImg", "imageUrl"],
            `${slug}-member-${index + 1}`
        );

        const birth = member.birthDate ||
            member.birthday ||
            member.birth ||
            "";

        const roles = member.roles ||
            member.position ||
            member.role ||
            member.positions ||
            "";

        const roleText = Array.isArray(roles)
            ? roles.join(", ")
            : roles;

        return `
        <article class="member-seo-card">
            ${photo ? `
                <img src="${escapeHTML(photo)}"
                     alt="${escapeHTML(name)}, membre de ${escapeHTML(groupName)}"
                     loading="lazy">
            ` : ""}

            <div class="member-seo-info">
                <h3>${escapeHTML(name)}</h3>

                ${member.fullName ? `
                    <p><strong>Nom complet :</strong>
                    ${escapeHTML(member.fullName)}</p>
                ` : ""}

                ${birth ? `
                    <p><strong>Date de naissance :</strong>
                    ${escapeHTML(birth)}</p>
                ` : ""}

                ${member.nationality ? `
                    <p><strong>Nationalité :</strong>
                    ${escapeHTML(member.nationality)}</p>
                ` : ""}

                ${roleText ? `
                    <p><strong>Rôles :</strong>
                    ${escapeHTML(roleText)}</p>
                ` : ""}

                ${member.description || member.bio ? `
                    <p>${escapeHTML(member.description || member.bio)}</p>
                ` : ""}
            </div>
        </article>`;
    }).join("\n");
}

// ==========================================
// DONNÉES STRUCTURÉES GOOGLE
// ==========================================

function buildSchema(group, url, banner) {
    const schema = {
        "@context": "https://schema.org",
        "@type": "MusicGroup",
        "name": group.name,
        "url": url,
        "genre": group.category || "Asian Pop"
    };

    if (banner) schema.image = new URL(banner, SITE_URL + "/groupes/").href;

    if (group.agency) {
        schema.founder = {
            "@type": "Organization",
            "name": group.agency
        };
    }

    if (group.origin) {
        schema.foundingLocation = {
            "@type": "Place",
            "name": group.origin
        };
    }

    if (group.members?.length) {
        schema.member = group.members.map(member => {
            const person = {
                "@type": "Person",
                "name": member.name
            };

            const birth = member.birthDate || member.birthday;

            if (birth && /^\d{4}-\d{2}-\d{2}$/.test(birth)) {
                person.birthDate = birth;
            }

            const role = member.roles || member.role || member.position;

            if (role) {
                person.jobTitle = Array.isArray(role)
                    ? role.join(", ")
                    : role;
            }

            return person;
        });
    }

    return schema;
}

// ==========================================
// CRÉATION DE LA PAGE HTML
// ==========================================

function generatePage(group, css) {
    const name = group.name;
    const slug = slugify(name);

    const url = `${SITE_URL}/groupes/${slug}.html`;

    const category = group.category || "Asian Pop";
    const agency = group.agency || "Non renseignée";
    const debut = group.debut || "Non renseigné";
    const fandom = group.fandomName || "Non renseigné";
    const origin = group.origin || "Non renseignée";

    const description =
        group.description ||
        group.bio ||
        `Découvre ${name} : biographie, agence, membres, informations et actualités du groupe ${category}.`;

    const banner = findImage(
        group,
        ["bannerImg", "banner", "cover", "image"],
        `${slug}-banner`
    );

    const logo = findImage(
        group,
        ["logoImg", "logo"],
        `${slug}-logo`
    );

    const membersHTML = renderMembers(group.members, slug, name);

    const schema = buildSchema(group, url, banner);

    const metaImage = banner
        ? `<meta property="og:image" content="${escapeHTML(
            new URL(banner, SITE_URL + "/groupes/").href
        )}">`
        : "";

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${escapeHTML(name)} : membres, biographie et profil | IBASE</title>

<meta name="description" content="${escapeHTML(description.slice(0, 155))}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${escapeHTML(url)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="IBASE">
<meta property="og:title" content="${escapeHTML(name)} : biographie et membres">
<meta property="og:description" content="${escapeHTML(description)}">
<meta property="og:url" content="${escapeHTML(url)}">
${metaImage}

<style>
${css}
</style>

<script type="application/ld+json">
${escapeJSON(schema)}
</script>
</head>

<body>

<header>
    <a class="logo" href="../index.html">I<span>BASE</span></a>
    <nav>
        <a href="../index.html">Accueil</a>
        <a href="../index.html#groups">Groupes</a>
        <a href="../index.html#dailyNews">Actualités</a>
    </nav>
</header>

<main class="group-seo-main">

<a class="group-seo-back" href="../index.html">
    ← Retour à IBASE
</a>

<article class="group-seo-card">

    <div class="group-seo-hero">
        ${banner ? `
            <img class="bg"
                 src="${escapeHTML(banner)}"
                 alt="${escapeHTML(name)}">
        ` : ""}

        ${logo ? `
            <div class="group-seo-logo">
                <img src="${escapeHTML(logo)}"
                     alt="Logo ${escapeHTML(name)}">
            </div>
        ` : ""}

        <h1>${escapeHTML(name)}</h1>
    </div>

    <div class="group-seo-body">

        <h2>Qui est ${escapeHTML(name)} ? Biographie du groupe</h2>

        <p>${escapeHTML(description)}</p>

        <div class="group-facts">

            <div class="group-fact">
                <b>Catégorie</b>
                <span>${escapeHTML(category)}</span>
            </div>

            <div class="group-fact">
                <b>Agence</b>
                <span>${escapeHTML(agency)}</span>
            </div>

            <div class="group-fact">
                <b>Date de début</b>
                <span>${escapeHTML(debut)}</span>
            </div>

            <div class="group-fact">
                <b>Origine</b>
                <span>${escapeHTML(origin)}</span>
            </div>

            <div class="group-fact">
                <b>Fandom</b>
                <span>${escapeHTML(fandom)}</span>
            </div>

            <div class="group-fact">
                <b>Nombre de membres</b>
                <span>${group.members?.length || "Non renseigné"}</span>
            </div>

        </div>

        <h2>Qui sont les membres de ${escapeHTML(name)} ?</h2>

        <div class="member-seo-grid">
            ${membersHTML}
        </div>

        <h2>Informations sur ${escapeHTML(name)}</h2>

        <p>
            Retrouve sur IBASE les informations concernant
            ${escapeHTML(name)}, ses membres, son histoire
            et son univers musical.
        </p>

    </div>
</article>
</main>

<footer>
    <p>IBASE — Asian Pop Database</p>
    <p>Fiche consacrée à ${escapeHTML(name)}.</p>
</footer>

</body>
</html>`;
}

// ==========================================
// MISE À JOUR DES LIENS DE L'ACCUEIL
// ==========================================

function updateHomepageLinks() {
    let html = fs.readFileSync(INDEX_FILE, "utf8");

    const target = "const group = groupsData[gi];";

    if (!html.includes(target)) {
        console.warn(
            "Attention : fonction openGroupPage non reconnue. " +
            "Les liens des cartes ne sont pas modifiés."
        );
        return;
    }

    // Déjà modifié lors d'un lancement précédent : on ne touche à rien.
    if (html.includes('window.location.href = "groupes/"')) {
        return;
    }

    // Note : les antislashs sont doublés pour que le code écrit
    // dans index.html contienne bien \u0300-\u036f.
    const replacement = `${target}
    if (group && group.name) {
        const slug = group.name.normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .toLowerCase()
            .replace(/&/g, "and")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");

        window.location.href = "groupes/" + slug + ".html";
        return;
    }`;

    // Fonction de remplacement : évite que "$" dans le texte soit interprété.
    html = html.replace(target, () => replacement);

    fs.writeFileSync(INDEX_FILE, html, "utf8");
}

// ==========================================
// GÉNÉRATION DU SITEMAP
// ==========================================

function generateSitemap(urls) {
    const entries = urls.map(url => `
    <url>
        <loc>${escapeHTML(url)}</loc>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>`).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${SITE_URL}/</loc>
        <changefreq>weekly</changefreq>
        <priority>1.0</priority>
    </url>
    ${entries}
</urlset>`;

    fs.writeFileSync(
        path.join(ROOT, "sitemap.xml"),
        xml,
        "utf8"
    );
}

// ==========================================
// LANCEMENT
// ==========================================

function main() {
    fs.mkdirSync(GROUPS_DIR, { recursive: true });
    fs.mkdirSync(IMAGES_DIR, { recursive: true });

    console.log("Lecture de la base IBASE...");

    const groups = readDatabase();
    const css = readTemplateCSS();

    const urls = [];
    const usedSlugs = new Set();

    let created = 0;

    for (const group of groups) {
        if (!group.name) continue;

        const slug = slugify(group.name);

        if (!slug || usedSlugs.has(slug)) {
            console.warn("Groupe ignoré : nom absent ou slug en double", group.name);
            continue;
        }

        usedSlugs.add(slug);

        const page = generatePage(group, css);

        fs.writeFileSync(
            path.join(GROUPS_DIR, `${slug}.html`),
            page,
            "utf8"
        );

        urls.push(`${SITE_URL}/groupes/${slug}.html`);

        created++;

        console.log(`Page créée : ${slug}.html`);
    }

    updateHomepageLinks();
    generateSitemap(urls);

    console.log("--------------------------------");
    console.log(`${created} pages de groupes générées.`);
    console.log("Sitemap.xml actualisé.");
    console.log("Liens de l'accueil actualisés.");
    console.log("--------------------------------");
}

try {
    main();
} catch (error) {
    console.error("Erreur pendant la génération :", error);
    process.exitCode = 1;
}

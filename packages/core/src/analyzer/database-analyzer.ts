/**
 * 数据库模型分析器
 * 通过正则表达式从 ORM 定义文件中提取数据模型、字段和关系信息。
 * 支持 SQLAlchemy、Prisma、TypeORM、Mongoose 四种 ORM。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode, DatabaseModel, DatabaseField, DatabaseRelation } from '../models/index.js';

// ============================================================================
// 模型文件过滤
// ============================================================================

/** 路径中包含这些关键词的文件可能定义数据模型 */
const MODEL_PATH_KEYWORDS = ['model', 'entity', 'schema', 'entities'];

/** 特定文件名（精确匹配）*/
const MODEL_FILE_NAMES = ['schema.prisma'];

/**
 * 判断文件是否可能包含数据模型定义
 * @param relativePath - 文件相对路径
 * @returns 是否为候选模型文件
 */
function isModelCandidateFile(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
    const basename = path.basename(normalized);

    if (MODEL_FILE_NAMES.includes(basename)) {
        return true;
    }

    return MODEL_PATH_KEYWORDS.some((kw) => normalized.includes(kw));
}

// ============================================================================
// SQLAlchemy 解析器
// ============================================================================

/** SQLAlchemy 类定义：class User(Base) 或 class User(db.Model) */
const SQLALCHEMY_CLASS_PATTERN = /class\s+(\w+)\s*\([^)]*(?:Base|Model)[^)]*\)/g;

/** SQLAlchemy Column 定义：name = Column(String, ...) */
const SQLALCHEMY_COLUMN_PATTERN = /(\w+)\s*=\s*Column\(\s*(\w+)/g;

/** SQLAlchemy relationship：children = relationship("Child") */
const SQLALCHEMY_RELATIONSHIP_PATTERN = /(\w+)\s*=\s*relationship\(\s*['"]?(\w+)/g;

/**
 * 从 SQLAlchemy 文件内容中提取模型
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的数据库模型数组
 */
function extractSQLAlchemyModels(content: string, filePath: string): DatabaseModel[] {
    const models: DatabaseModel[] = [];

    SQLALCHEMY_CLASS_PATTERN.lastIndex = 0;
    let classMatch: RegExpExecArray | null;

    while ((classMatch = SQLALCHEMY_CLASS_PATTERN.exec(content)) !== null) {
        const modelName = classMatch[1];
        const classStartIndex = classMatch.index;

        // 查找此类的大致范围（到下一个 class 或文件末尾）
        const nextClassIndex = content.indexOf('\nclass ', classStartIndex + 1);
        const classBody =
            nextClassIndex !== -1
                ? content.slice(classStartIndex, nextClassIndex)
                : content.slice(classStartIndex);

        // 提取字段
        const fields: DatabaseField[] = [];
        SQLALCHEMY_COLUMN_PATTERN.lastIndex = 0;
        let colMatch: RegExpExecArray | null;
        while ((colMatch = SQLALCHEMY_COLUMN_PATTERN.exec(classBody)) !== null) {
            fields.push({
                name: colMatch[1],
                type: colMatch[2],
                nullable: classBody.includes(`${colMatch[1]}`) && classBody.includes('nullable=True'),
            });
        }

        // 提取关系
        const relations: DatabaseRelation[] = [];
        SQLALCHEMY_RELATIONSHIP_PATTERN.lastIndex = 0;
        let relMatch: RegExpExecArray | null;
        while ((relMatch = SQLALCHEMY_RELATIONSHIP_PATTERN.exec(classBody)) !== null) {
            relations.push({
                fieldName: relMatch[1],
                relatedModel: relMatch[2],
                relationType: 'relationship',
            });
        }

        models.push({
            name: modelName,
            filePath,
            orm: 'sqlalchemy',
            fields,
            relations,
        });
    }

    return models;
}

// ============================================================================
// Prisma 解析器
// ============================================================================

/** Prisma model 块：model User { ... } */
const PRISMA_MODEL_PATTERN = /model\s+(\w+)\s*\{([^}]*)\}/g;

/** Prisma 字段行：name  Type?  @... */
const PRISMA_FIELD_PATTERN = /^\s+(\w+)\s+(\w+)(\??)/gm;

/**
 * 从 Prisma schema 文件中提取模型
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的数据库模型数组
 */
function extractPrismaModels(content: string, filePath: string): DatabaseModel[] {
    const models: DatabaseModel[] = [];

    // 先收集所有模型名称用于关系推断
    const allModelNames = new Set<string>();
    PRISMA_MODEL_PATTERN.lastIndex = 0;
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = PRISMA_MODEL_PATTERN.exec(content)) !== null) {
        allModelNames.add(nameMatch[1]);
    }

    PRISMA_MODEL_PATTERN.lastIndex = 0;
    let modelMatch: RegExpExecArray | null;

    while ((modelMatch = PRISMA_MODEL_PATTERN.exec(content)) !== null) {
        const modelName = modelMatch[1];
        const modelBody = modelMatch[2];

        const fields: DatabaseField[] = [];
        const relations: DatabaseRelation[] = [];

        // 逐行解析模型体
        const bodyLines = modelBody.split('\n');
        for (const line of bodyLines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
                continue;
            }

            // 匹配字段：fieldName  FieldType?  @...
            const fieldMatch = /^(\w+)\s+(\w+)(\??)(\[\])?/.exec(trimmed);
            if (fieldMatch) {
                const fieldName = fieldMatch[1];
                const fieldType = fieldMatch[2];
                const isNullable = fieldMatch[3] === '?';
                const isArray = fieldMatch[4] === '[]';

                // 如果类型是另一个模型名称，则为关系字段
                if (allModelNames.has(fieldType)) {
                    relations.push({
                        fieldName,
                        relatedModel: fieldType,
                        relationType: isArray ? 'OneToMany' : 'ManyToOne',
                    });
                } else {
                    fields.push({
                        name: fieldName,
                        type: fieldType,
                        nullable: isNullable,
                    });
                }
            }
        }

        models.push({
            name: modelName,
            filePath,
            orm: 'prisma',
            fields,
            relations,
        });
    }

    return models;
}

// ============================================================================
// TypeORM 解析器
// ============================================================================

/** TypeORM @Entity() 装饰器后的类名 */
const TYPEORM_ENTITY_PATTERN = /@Entity\(\s*\)\s*(?:export\s+)?class\s+(\w+)/g;

/** TypeORM @Column 装饰器后的属性 */
const TYPEORM_COLUMN_PATTERN = /@Column\([^)]*\)\s*(\w+)\s*[!?]?\s*:\s*(\w+)/g;

/** TypeORM 关系装饰器 */
const TYPEORM_RELATION_PATTERN =
    /@(ManyToOne|OneToMany|ManyToMany|OneToOne)\([^)]*\)\s*(\w+)\s*[!?]?\s*:/g;

/**
 * 从 TypeORM 文件中提取模型
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的数据库模型数组
 */
function extractTypeORMModels(content: string, filePath: string): DatabaseModel[] {
    const models: DatabaseModel[] = [];

    // 检测所有 Entity 定义的位置
    const entityPositions: Array<{ name: string; startIndex: number }> = [];
    TYPEORM_ENTITY_PATTERN.lastIndex = 0;
    let entityMatch: RegExpExecArray | null;
    while ((entityMatch = TYPEORM_ENTITY_PATTERN.exec(content)) !== null) {
        entityPositions.push({ name: entityMatch[1], startIndex: entityMatch.index });
    }

    for (let i = 0; i < entityPositions.length; i++) {
        const entity = entityPositions[i];
        const nextStart =
            i + 1 < entityPositions.length ? entityPositions[i + 1].startIndex : content.length;
        const classBody = content.slice(entity.startIndex, nextStart);

        // 提取字段
        const fields: DatabaseField[] = [];
        TYPEORM_COLUMN_PATTERN.lastIndex = 0;
        let colMatch: RegExpExecArray | null;
        while ((colMatch = TYPEORM_COLUMN_PATTERN.exec(classBody)) !== null) {
            fields.push({
                name: colMatch[1],
                type: colMatch[2],
                nullable: classBody.includes('nullable: true'),
            });
        }

        // 提取关系
        const relations: DatabaseRelation[] = [];
        TYPEORM_RELATION_PATTERN.lastIndex = 0;
        let relMatch: RegExpExecArray | null;
        while ((relMatch = TYPEORM_RELATION_PATTERN.exec(classBody)) !== null) {
            // 尝试从装饰器参数中提取关联模型
            const afterDecorator = classBody.slice(relMatch.index);
            const modelRef = /\(\s*\(\)\s*=>\s*(\w+)/.exec(afterDecorator);

            relations.push({
                fieldName: relMatch[2],
                relatedModel: modelRef ? modelRef[1] : '',
                relationType: relMatch[1],
            });
        }

        models.push({
            name: entity.name,
            filePath,
            orm: 'typeorm',
            fields,
            relations,
        });
    }

    return models;
}

// ============================================================================
// Mongoose 解析器
// ============================================================================

/** Mongoose Schema 构造 */
const MONGOOSE_SCHEMA_PATTERN = /(?:new\s+(?:mongoose\.)?Schema|mongoose\.Schema)\s*\(/g;

/** 变量名赋值形式：const userSchema = new Schema( */
const MONGOOSE_SCHEMA_VAR_PATTERN =
    /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(/g;

/**
 * 从 Mongoose 文件中提取模型
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的数据库模型数组
 */
function extractMongooseModels(content: string, filePath: string): DatabaseModel[] {
    const models: DatabaseModel[] = [];

    // 尝试从 mongoose.model("Name", schema) 中提取模型名
    const modelNamePattern = /mongoose\.model\s*\(\s*['"](\w+)['"]/g;
    const modelNames: string[] = [];
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = modelNamePattern.exec(content)) !== null) {
        modelNames.push(nameMatch[1]);
    }

    // 同时尝试从变量名推断
    MONGOOSE_SCHEMA_VAR_PATTERN.lastIndex = 0;
    let varMatch: RegExpExecArray | null;
    while ((varMatch = MONGOOSE_SCHEMA_VAR_PATTERN.exec(content)) !== null) {
        const varName = varMatch[1];
        // 将 userSchema 转换为 User
        const inferred = varName
            .replace(/Schema$/i, '')
            .replace(/^./, (c) => c.toUpperCase());

        if (inferred && !modelNames.includes(inferred)) {
            modelNames.push(inferred);
        }
    }

    // 检查文件是否确实包含 Schema 构造
    MONGOOSE_SCHEMA_PATTERN.lastIndex = 0;
    if (!MONGOOSE_SCHEMA_PATTERN.test(content)) {
        return models;
    }

    // 提取 Schema 对象中的属性定义
    // 简单匹配 key: { type: Type } 或 key: Type 模式
    const fields: DatabaseField[] = [];
    const schemaFieldPattern = /(\w+)\s*:\s*\{?\s*type\s*:\s*(\w+)/g;
    const simpleFieldPattern = /(\w+)\s*:\s*(String|Number|Boolean|Date|ObjectId|Buffer|Map)/g;

    let fieldMatch: RegExpExecArray | null;
    schemaFieldPattern.lastIndex = 0;
    while ((fieldMatch = schemaFieldPattern.exec(content)) !== null) {
        if (!fields.some((f) => f.name === fieldMatch![1])) {
            fields.push({
                name: fieldMatch[1],
                type: fieldMatch[2],
                nullable: false,
            });
        }
    }

    simpleFieldPattern.lastIndex = 0;
    while ((fieldMatch = simpleFieldPattern.exec(content)) !== null) {
        if (!fields.some((f) => f.name === fieldMatch![1])) {
            fields.push({
                name: fieldMatch[1],
                type: fieldMatch[2],
                nullable: false,
            });
        }
    }

    // 检测关系（ObjectId + ref）
    const relations: DatabaseRelation[] = [];
    const refPattern = /(\w+)\s*:.*ref\s*:\s*['"](\w+)['"]/g;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = refPattern.exec(content)) !== null) {
        relations.push({
            fieldName: refMatch[1],
            relatedModel: refMatch[2],
            relationType: 'ref',
        });
    }

    // 为每个检测到的模型名创建记录
    const effectiveNames = modelNames.length > 0 ? modelNames : [guessModelNameFromPath(filePath)];
    for (const name of effectiveNames) {
        models.push({
            name,
            filePath,
            orm: 'mongoose',
            fields: [...fields],
            relations: [...relations],
        });
    }

    return models;
}

/**
 * 从文件路径中猜测模型名
 * @param filePath - 文件相对路径
 * @returns 猜测的模型名
 */
function guessModelNameFromPath(filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));
    // 移除常见后缀
    const cleaned = basename.replace(/[.\-_]?(model|entity|schema)$/i, '');
    return cleaned.replace(/^./, (c) => c.toUpperCase());
}

// ============================================================================
// ORM 检测与分发
// ============================================================================

/**
 * 检测文件中使用的 ORM 并提取模型
 * @param content - 文件内容
 * @param filePath - 文件相对路径
 * @returns 提取到的数据库模型数组
 */
function extractModelsFromContent(content: string, filePath: string): DatabaseModel[] {
    const allModels: DatabaseModel[] = [];

    // Prisma（根据文件扩展名和内容特征判断）
    if (filePath.endsWith('.prisma') || /^model\s+\w+\s*\{/m.test(content)) {
        allModels.push(...extractPrismaModels(content, filePath));
    }

    // SQLAlchemy（Python 风格 + Base/Model 继承）
    if (/class\s+\w+\s*\([^)]*(?:Base|Model)/.test(content) && /Column\(/.test(content)) {
        allModels.push(...extractSQLAlchemyModels(content, filePath));
    }

    // TypeORM（@Entity 装饰器）
    if (/@Entity\s*\(/.test(content)) {
        allModels.push(...extractTypeORMModels(content, filePath));
    }

    // Mongoose（new Schema 或 mongoose.Schema）
    if (/(?:new\s+(?:mongoose\.)?Schema|mongoose\.Schema)\s*\(/.test(content)) {
        allModels.push(...extractMongooseModels(content, filePath));
    }

    return allModels;
}

/**
 * 分析项目中的数据库模型定义
 *
 * 从扫描到的文件列表中筛选可能包含 ORM 模型定义的文件，
 * 读取其内容并通过正则提取模型名、字段和关系信息。
 *
 * 支持的 ORM：
 * - SQLAlchemy（Python，Column + relationship 解析）
 * - Prisma（schema.prisma 文件解析）
 * - TypeORM（TypeScript @Entity 装饰器解析）
 * - Mongoose（TypeScript/JavaScript Schema 解析）
 *
 * @param rootPath - 项目根目录的绝对路径
 * @param files - 扫描到的 FileNode 列表
 * @returns 排序后的 DatabaseModel 数组
 */
export async function analyzeDatabaseModels(
    rootPath: string,
    files: FileNode[],
): Promise<DatabaseModel[]> {
    const allModels: DatabaseModel[] = [];

    // 筛选候选文件
    const candidates = files.filter(
        (f) => f.nodeType === 'file' && isModelCandidateFile(f.relativePath),
    );

    for (const candidate of candidates) {
        try {
            const absolutePath = path.resolve(rootPath, candidate.relativePath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            const models = extractModelsFromContent(content, candidate.relativePath);
            allModels.push(...models);
        } catch {
            // 无法读取的文件直接跳过
            continue;
        }
    }

    // 按文件路径和模型名排序
    allModels.sort((a, b) => {
        const fileCmp = a.filePath.localeCompare(b.filePath);
        if (fileCmp !== 0) return fileCmp;
        return a.name.localeCompare(b.name);
    });

    return allModels;
}

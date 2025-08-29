import * as fs from 'fs';

/* Converted from https://github.com/spapazov/tf-idf-search */

/**
 * Represents a document in the corpus tracking system
 */
export interface DocumentTracker {
    index: number;
    document: string;
}

/**
 * Represents a ranked document with similarity scoring
 */
export interface RankedDocument {
    document: string[];
    similarityIndex: number;
    index: number;
}

/**
 * Factory for calculating the tf-idf for a text/document
 * To be used for the purpose of ranking search results
 * Rankings are based upon the classical version of the Vector Space Model
 * @see https://en.wikipedia.org/wiki/Vector_space_model
 * @author spapazov
 * @license MIT
 */
export class TfIdf {
    private corpus: string[][] = [];
    private tracker: DocumentTracker[] = [];
    private vectorSpaceModel?: number[];

    /**
     * Breaks a string into an array of words (aka document)
     */
    addDocumentFromString(str: string): string[][] {
        const strArray = str
            .replace(/[\r\n]/g, " ")
            .trim()
            .split(" ");
        this.corpus.push(strArray);
        this.tracker.push({
            index: this.corpus.length - 1,
            document: str
        });
        return this.corpus;
    }

    /**
     * Adds document from file path
     */
    addDocumentFromPath(path: string): string[][] {
        try {
            let data = fs.readFileSync(path, { encoding: 'utf8' });
            data = data.replace(/[\r\n]/g, " ");
            data = data.trim();
            this.corpus.push(data.split(" "));
            this.tracker.push({
                index: this.corpus.length - 1,
                document: path
            });
        } catch (err) {
            throw err;
        }
        return this.corpus;
    }

    /**
     * Creates a corpus from an array of docs
     */
    createCorpusFromStringArray(docs: string[]): string[][] {
        for (let i = 0; i < docs.length; i++) {
            this.corpus.push(
                docs[i]
                    .replace(/[\r\n]/g, " ")
                    .trim()
                    .split(" ")
            );
            this.tracker.push({
                index: this.corpus.length - 1,
                document: docs[i]
            });
        }
        return this.corpus;
    }

    /**
     * Creates a corpus from an array of file paths
     */
    createCorpusFromPathArray(docs: string[]): string[][] {
        for (let i = 0; i < docs.length; i++) {
            try {
                let data = fs.readFileSync(docs[i], { encoding: 'utf8' });
                data = data.replace(/[\r\n]/g, " ");
                data = data.trim();
                this.corpus.push(data.split(" "));
                this.tracker.push({
                    index: this.corpus.length - 1,
                    document: docs[i]
                });
            } catch (err) {
                throw err;
            }
        }
        return this.corpus;
    }

    /**
     * Calculates the term frequency (tf) of a given term in a document
     * Term frequency is computed as:
     * number of occurrences of the term / length of document;
     */
    calculateTermFrequency(term: string, doc: string[]): number {
        let numOccurrences = 0;
        for (let i = 0; i < doc.length; i++) {
            if (doc[i].toLowerCase() === term.toLowerCase()) {
                numOccurrences++;
            }
        }
        return (numOccurrences * 1.0) / (doc.length + 1);
    }

    /**
     * Calculates the inverse document frequency (idf) of a term in a given document
     * idf = log(number of documents where the term appears / term frequency)
     */
    calculateInverseDocumentFrequency(term: string): number {
        if (this.corpus.length === 0) return -1;
        let numDocs = 0;
        for (let i = 0; i < this.corpus.length; i++) {
            for (let j = 0; j < this.corpus[i].length; j++) {
                if (this.corpus[i][j].toLowerCase() === term.toLowerCase()) {
                    numDocs++;
                    break;
                }
            }
        }
        return Math.log(this.corpus.length / (numDocs + 1)) + 1;
    }

    /**
     * Creates a vector of the idf of the query term in a given document
     */
    createIdfModel(query: string | string[]): number[] | null {
        const queryArray = Array.isArray(query) ? query : query.split(" ");
        if (this.corpus.length === 0) return null;
        const model: number[] = [];
        for (let i = 0; i < queryArray.length; i++) {
            model.push(this.calculateInverseDocumentFrequency(queryArray[i]));
        }
        return model;
    }

    /**
     * Creates a vector of the tf-idf values for each query term
     * tf-idf = tf * idf
     */
    createVectorSpaceModel(query: string | string[], doc: string[]): number[] | null {
        const queryArray = Array.isArray(query) ? query : query.split(" ");
        if (this.corpus.length === 0) return null;
        const termFrequencyModel: number[] = [];
        const vectorSpaceModel: number[] = [];

        for (let i = 0; i < queryArray.length; i++) {
            termFrequencyModel.push(this.calculateTermFrequency(queryArray[i], doc));
        }

        const idfModel = this.createIdfModel(queryArray);
        if (!idfModel) return null;

        for (let j = 0; j < idfModel.length; j++) {
            vectorSpaceModel[j] = idfModel[j] * termFrequencyModel[j];
        }

        this.vectorSpaceModel = vectorSpaceModel;
        return vectorSpaceModel;
    }

    /**
     * Calculates the cosine similarity between two vectors computed as their dot
     * product. The higher the cosine similarity of a given document the closer of
     * a match it is to the query.
     */
    calculateSimilarityIndex(query: string | string[], doc: string[]): number {
        const queryArray = Array.isArray(query) ? query : query.split(" ");
        const queryVector = this.createVectorSpaceModel(queryArray, queryArray);
        const docVector = this.createVectorSpaceModel(queryArray, doc);

        if (!queryVector || !docVector) return 0;

        let similarityIndex = 0;
        for (let i = 0; i < queryArray.length; i++) {
            const toAdd = queryVector[i] * docVector[i];
            if (isNaN(toAdd)) {
                similarityIndex += 0;
            } else {
                similarityIndex += toAdd;
            }
        }

        const queryMag = this.calculateMagnitude(queryVector);
        const docMag = this.calculateMagnitude(docVector);
        const similarity = (1.0 * similarityIndex) / (queryMag * docMag);
        return isNaN(similarity) ? 0 : similarity;
    }

    /**
     * Ranks the documents in your corpus according to a query
     */
    rankDocumentsByQuery(query: string): RankedDocument[] {
        const queryArray = query.split(" ");
        const ranking: RankedDocument[] = [];

        for (let i = 0; i < this.corpus.length; i++) {
            ranking.push({
                document: this.corpus[i],
                similarityIndex: this.calculateSimilarityIndex(queryArray, this.corpus[i]),
                index: i,
            });
        }

        ranking.sort((a, b) => {
            return b.similarityIndex - a.similarityIndex;
        });

        return ranking;
    }

    /**
     * Calculates the magnitude of an input vector
     */
    calculateMagnitude(vector: number[]): number {
        let magnitude = 0;
        for (let i = 0; i < vector.length; i++) {
            if (isNaN(vector[i])) {
                magnitude += 0;
            } else {
                magnitude += vector[i] * vector[i];
            }
        }
        return Math.sqrt(magnitude);
    }

    /**
     * Find tracker of original documents
     */
    indicesOfInputs(): DocumentTracker[] {
        return this.tracker;
    }
}
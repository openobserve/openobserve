const useParser = () => {
  const sqlParser = async () => {
    const Parser: any = await import("node-sql-parser/build/mysql");

    if (Parser) {
      return new Parser.default.Parser();
    }
  };

  return {
    sqlParser,
  };
};

export default useParser;

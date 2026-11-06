import { Command } from "commander";

export function createCli(): Command {
    const program = new Command();

    program
        .name("manager")
        .description("manager cli")
        .version("1.0.0");

    registerMasterCommands(program);


    return program;
}